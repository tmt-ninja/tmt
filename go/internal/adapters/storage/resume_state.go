package storage

import (
	"encoding/hex"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

// The launch model comes from the starting report. A later observed model
// never becomes launch authority, and a partially readable state has no model.
func resumeStateModel(session *core.ResumeSession) *string {
	if session == nil || session.State == nil {
		return nil
	}
	switch session.Driver {
	case core.DriverClaude, core.DriverCodex, "agy", "pi":
	default:
		return nil
	}
	state := session.State
	var document struct {
		Model         *string        `json:"model"`
		Usage         jsontext.Value `json:"usage"`
		Activity      jsontext.Value `json:"activity"`
		Consumption   jsontext.Value `json:"consumption"`
		Observed      jsontext.Value `json:"observed"`
		NoStartupIdle jsontext.Value `json:"noStartupIdle"`
	}
	if json.Unmarshal([]byte(state.JSON), &document, json.RejectUnknownMembers(true)) != nil ||
		document.Model == nil || !validResumeModel(document.Model) {
		return nil
	}
	usage := document.Usage != nil
	activity := document.Activity != nil
	consumption := document.Consumption != nil
	observed := document.Observed != nil
	suppressed := document.NoStartupIdle != nil
	if observed && state.Version != 5 && state.Version != 6 || suppressed && state.Version != 6 {
		return nil
	}
	switch state.Version {
	case 1:
		if usage || activity || consumption {
			return nil
		}
	case 2:
		if !usage || activity || consumption {
			return nil
		}
	case 3:
		if !activity || consumption {
			return nil
		}
	case 4:
		if !consumption {
			return nil
		}
	case 5:
		if !observed {
			return nil
		}
	case 6:
		if !suppressed {
			return nil
		}
	default:
		return nil
	}
	if usage && !validResumeUsage(document.Usage) ||
		activity && !validResumeActivity(document.Activity) ||
		consumption && !validResumeConsumption(document.Consumption) ||
		observed && !validResumeObserved(document.Observed) ||
		suppressed && !validResumeStartupSuppression(document.NoStartupIdle) {
		return nil
	}
	if session.Driver == "pi" {
		switch strings.ToLower(*document.Model) {
		case "unknown", "auto", "default":
			return nil
		}
	}
	return document.Model
}

func validResumeUsage(data jsontext.Value) bool {
	var usage struct {
		Tokens       *uint64        `json:"tokens"`
		ObservedAtMs uint64         `json:"observedAtMs"`
		WindowTokens jsontext.Value `json:"windowTokens"`
	}
	if json.Unmarshal(data, &usage, json.RejectUnknownMembers(true)) != nil ||
		usage.Tokens == nil || !core.ValidJSSafeInteger(*usage.Tokens) || !safeTime(usage.ObservedAtMs) {
		return false
	}
	var window uint64
	return usage.WindowTokens == nil || json.Unmarshal(usage.WindowTokens, &window) == nil && safeTime(window)
}

func validResumeActivity(data jsontext.Value) bool {
	var activity launchActivity
	var fields map[string]jsontext.Value
	if json.Unmarshal(data, &fields) != nil || len(fields) != 7 ||
		json.Unmarshal(data, &activity, json.RejectUnknownMembers(true)) != nil {
		return false
	}
	return validStart(activity.Session) && safeTime(activity.PID) && validStart(activity.Start) &&
		(activity.State == "working" || activity.State == "waiting" || activity.State == "idle") &&
		(activity.Turn == nil || validStart(*activity.Turn)) &&
		activity.SinceMs > 0 && activity.SinceMs <= activity.LastActivityMs && safeTime(activity.LastActivityMs)
}

func validResumeObserved(data jsontext.Value) bool {
	var observed struct {
		Model        *string `json:"model"`
		ObservedAtMs uint64  `json:"observedAtMs"`
	}
	return json.Unmarshal(data, &observed, json.RejectUnknownMembers(true)) == nil &&
		observed.Model != nil && validResumeModel(observed.Model) && safeTime(observed.ObservedAtMs)
}

func validResumeStartupSuppression(data jsontext.Value) bool {
	var fence struct {
		Session string `json:"session"`
		PID     uint64 `json:"pid"`
		Start   string `json:"start"`
	}
	return json.Unmarshal(data, &fence, json.RejectUnknownMembers(true)) == nil &&
		validStart(fence.Session) && safeTime(fence.PID) && validStart(fence.Start)
}

type resumeConsumptionCounts struct {
	Input  *uint64 `json:"input"`
	Output *uint64 `json:"output"`
	Cached *uint64 `json:"cached"`
}

func (c resumeConsumptionCounts) tokens() (core.UsageTokens, bool) {
	if c.Input == nil || c.Output == nil || c.Cached == nil {
		return core.UsageTokens{}, false
	}
	tokens := core.UsageTokens{InputTokens: *c.Input, OutputTokens: *c.Output, CachedInputTokens: *c.Cached}
	return tokens, validUsageTokens(tokens)
}

func validResumeConsumption(data jsontext.Value) bool {
	var consumption struct {
		Value  jsontext.Value `json:"value"`
		Cursor *struct {
			Dev     *uint64                  `json:"dev"`
			Ino     *uint64                  `json:"ino"`
			Offset  *uint64                  `json:"offset"`
			Last    *string                  `json:"last"`
			Request *string                  `json:"request"`
			Counts  *resumeConsumptionCounts `json:"counts"`
			Discard jsontext.Value           `json:"discard"`
		} `json:"cursor"`
		Family *struct {
			resumeConsumptionCounts
			Incomplete jsontext.Value `json:"incomplete"`
		} `json:"family"`
	}
	if json.Unmarshal(data, &consumption, json.RejectUnknownMembers(true)) != nil {
		return false
	}
	reading, ok := resumeConsumptionReading(consumption.Value)
	if !ok {
		return false
	}
	if family := consumption.Family; family != nil {
		tokens, valid := family.tokens()
		if !valid || !validOptionalResumeBool(family.Incomplete) || !withinUsageTokens(tokens, reading.UsageTokens) {
			return false
		}
	}
	if cursor := consumption.Cursor; cursor != nil {
		if cursor.Dev == nil || cursor.Ino == nil || cursor.Offset == nil ||
			!validOptionalResumeBool(cursor.Discard) || !validResumeCursorHash(cursor.Last) || !validResumeCursorHash(cursor.Request) ||
			(cursor.Last == nil) != (cursor.Counts == nil) || cursor.Last == nil && cursor.Request != nil {
			return false
		}
		if cursor.Counts != nil {
			_, valid := cursor.Counts.tokens()
			return valid
		}
	}
	return true
}

func validResumeCursorHash(hash *string) bool {
	if hash == nil {
		return true
	}
	_, err := hex.DecodeString(*hash)
	return len(*hash) == 64 && err == nil
}

func validOptionalResumeBool(value jsontext.Value) bool {
	return value == nil || value.Kind() == 't' || value.Kind() == 'f'
}

func hasResumeFields(fields map[string]jsontext.Value, required ...string) bool {
	for _, field := range required {
		if raw := fields[field]; raw == nil || raw.Kind() == 'n' {
			return false
		}
	}
	return true
}

func resumeConsumptionReading(data jsontext.Value) (core.ConsumptionReading, bool) {
	var fields map[string]jsontext.Value
	if json.Unmarshal(data, &fields) != nil ||
		!hasResumeFields(fields, "inputTokens", "outputTokens", "cachedInputTokens", "complete", "gap") {
		return core.ConsumptionReading{}, false
	}
	if credits := fields["credits"]; credits != nil && credits.Kind() != 'n' {
		var document map[string]jsontext.Value
		if json.Unmarshal(credits, &document) != nil || !hasResumeFields(document, "unlimited", "hasCredits") {
			return core.ConsumptionReading{}, false
		}
	}
	if limits := fields["rateLimits"]; limits != nil && limits.Kind() != 'n' {
		var document struct {
			Windows []map[string]jsontext.Value `json:"windows"`
		}
		if json.Unmarshal(limits, &document) != nil {
			return core.ConsumptionReading{}, false
		}
		for _, window := range document.Windows {
			if !hasResumeFields(window, "windowMinutes", "usedPercent", "resetsAtMs") {
				return core.ConsumptionReading{}, false
			}
		}
	}
	if delta := fields["deltaByModel"]; delta != nil && delta.Kind() == '[' {
		var rows []jsontext.Value
		if json.Unmarshal(delta, &rows) != nil {
			return core.ConsumptionReading{}, false
		}
		for i, row := range rows {
			if row.Kind() != '[' {
				var document map[string]jsontext.Value
				if json.Unmarshal(row, &document) != nil ||
					!hasResumeFields(document, "modelId", "inputTokens", "outputTokens", "cachedInputTokens") {
					return core.ConsumptionReading{}, false
				}
				continue
			}
			var tuple []jsontext.Value
			if json.Unmarshal(row, &tuple) != nil || len(tuple) != 5 || tuple[0].Kind() == 'n' ||
				tuple[1].Kind() == 'n' || tuple[2].Kind() == 'n' || tuple[3].Kind() == 'n' {
				return core.ConsumptionReading{}, false
			}
			encoded, err := json.Marshal(map[string]jsontext.Value{
				"modelId": tuple[0], "inputTokens": tuple[1], "outputTokens": tuple[2],
				"cachedInputTokens": tuple[3], "cacheWriteTokens": tuple[4],
			})
			if err != nil {
				return core.ConsumptionReading{}, false
			}
			rows[i] = encoded
		}
		encoded, err := json.Marshal(rows)
		if err != nil {
			return core.ConsumptionReading{}, false
		}
		fields["deltaByModel"] = encoded
		data, err = json.Marshal(fields)
		if err != nil {
			return core.ConsumptionReading{}, false
		}
	}
	var reading core.ConsumptionReading
	if decodeUsageJSON(data, &reading) != nil {
		return core.ConsumptionReading{}, false
	}
	return reading, validConsumptionReading(&core.ConsumptionLatest{Consumption: reading})
}
