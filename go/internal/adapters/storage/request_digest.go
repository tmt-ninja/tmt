package storage

import (
	"encoding/json/v2"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func insertRequestDeliveryPolicy(r records, id core.RequestID, p core.RequestDeliveryPolicy) error {
	_, err := r.exec(`INSERT INTO request_delivery_policies(request_id,urgent,kind,automatic,mode)
		VALUES(?,?,?,?,?)`, id, p.Urgent, p.Kind, p.Automatic, p.Mode)
	return err
}

type digestHoldAdmission struct {
	until                            uint64
	receiving                        core.OrchReceivingMode
	contextTokens, contextObservedAt *uint64
	phase                            *core.DigestPhase
}

func incomingDigestHold(r records, in core.PrepareRequest, cal digestCalendar, now uint64) (*digestHoldAdmission, error) {
	p := in.DeliveryPolicy
	if p == nil || !p.Automatic || in.Route.Kind != core.RequestRouteInbox || in.Recipient == nil {
		return nil, nil
	}
	identity, err := r.Identities().FindByID(*in.Recipient)
	if err != nil || identity == nil {
		return nil, err
	}
	legacy, err := digestPolicy(r, identity.ID)
	if err != nil || legacy == nil || legacy.UntilMs <= now {
		return nil, err
	}
	person, err := digestIsUser(r, identity.ID)
	if err != nil || person {
		return nil, err
	}
	if in.Originator.IdentityID != nil {
		person, err = digestIsUser(r, *in.Originator.IdentityID)
		if err != nil || person {
			return nil, err
		}
	}
	recipient, err := digestRecipientEvidence(r, identity.ID)
	if err != nil || !recipient.canReportIdle() {
		return nil, err
	}
	resolved, err := resolveDigestReceiving(r, identity, cal, now)
	if err != nil {
		return nil, err
	}

	fromOwner := in.Originator.IdentityID != nil && *in.Originator.IdentityID == legacy.OwnerID
	switch {
	case resolved.mode == core.OrchReceivingDirect || p.Urgent && resolved.mode != core.OrchReceivingHold:
		return nil, nil
	case fromOwner && (resolved.mode == "" || resolved.source.Kind == core.OrchSourceBase &&
		(resolved.mode == core.OrchReceivingAuto || resolved.mode == core.OrchReceivingBatch)):
		return nil, nil
	}
	until := legacy.UntilMs
	if resolved.nextChange != nil {
		until = min(until, *resolved.nextChange)
	}
	hold := digestHoldAdmission{until: until, receiving: resolved.mode}
	if activity := recipient.activity(); activity != nil {
		phase := core.DigestPhase(activity.State)
		hold.phase = &phase
	}
	if recipient.currentUsage && recipient.state.Usage != nil {
		usage := recipient.state.Usage
		if core.ValidJSSafeInteger(usage.Tokens) && safeTime(usage.ObservedAtMs) && usage.ObservedAtMs <= now {
			hold.contextTokens, hold.contextObservedAt = &usage.Tokens, &usage.ObservedAtMs
		}
	}
	return &hold, nil
}

func recordIncomingDigestHold(r records, in core.PrepareRequest, hold digestHoldAdmission, now uint64) error {
	_, err := r.exec(`INSERT INTO focus_items(identity_id,request_id,kind,source,created_at_ms,context_tokens_at_arrival,
		context_observed_at_ms,phase_at_arrival) VALUES(?,?,?,'incoming',?,?,?,?)`,
		*in.Recipient, in.RequestID, in.DeliveryPolicy.Kind, now, hold.contextTokens, hold.contextObservedAt, hold.phase)
	if err != nil || hold.receiving != core.OrchReceivingUrgent && hold.receiving != core.OrchReceivingHold {
		return err
	}
	class := digestOrdinaryClass
	if in.DeliveryPolicy.Urgent {
		class = digestUrgentClass
	}
	// Preserve the first hold time and any in-flight summary link. Only a new
	// class changes the marker while a different writer owns its membership.
	_, err = r.exec(`INSERT INTO orchestration_pending_wakes(identity_id,released_classes,released_at_ms) VALUES(?,?,?)
		ON CONFLICT(identity_id) DO UPDATE SET released_classes=(released_classes | excluded.released_classes)
		WHERE (released_classes | excluded.released_classes)<>released_classes`, *in.Recipient, class, now)
	return err
}

type digestRecipientState struct {
	Activity *launchActivity `json:"activity"`
	Usage    *struct {
		Tokens       uint64 `json:"tokens"`
		ObservedAtMs uint64 `json:"observedAtMs"`
	} `json:"usage"`
	NoStartupIdle *struct {
		Session string `json:"session"`
		PID     uint64 `json:"pid"`
		Start   string `json:"start"`
	} `json:"noStartupIdle"`
}

type digestRecipient struct {
	binding           *core.Binding
	driver            *core.DriverName
	rememberedSession *string
	state             digestRecipientState
	currentUsage      bool
}

func digestRecipientEvidence(r records, id core.IdentityID) (digestRecipient, error) {
	var recipient digestRecipient
	var err error
	recipient.binding, err = r.Bindings().FindByIdentity(id)
	if err != nil {
		return recipient, err
	}
	var raw []byte
	err = r.one(`SELECT COALESCE(p.remembered_harness,p.preferred_harness,
		(SELECT driver FROM launch_observations l JOIN bindings b ON b.id=l.binding_id
		WHERE b.identity_id=?1 AND l.owner_pid=b.launch_owner_pid AND l.owner_start=b.launch_owner_start_identity)),
		p.provider_session_id,p.driver_state,p.remembered_harness IS NOT NULL AND p.stale_at_ms IS NULL AND p.resume_pending_at_ms IS NULL
		FROM identities i LEFT JOIN identity_session_preferences p ON p.identity_id=i.id WHERE i.id=?1`, id).
		Scan(&recipient.driver, &recipient.rememberedSession, &raw, &recipient.currentUsage)
	if err != nil {
		return recipient, err
	}
	if raw != nil && json.Unmarshal(raw, &recipient.state) != nil {
		recipient.state = digestRecipientState{}
	}
	return recipient, nil
}

func (d digestRecipient) matchesSession(session string, pid uint64, start string) bool {
	if d.binding == nil || d.rememberedSession == nil {
		return false
	}
	b := d.binding.Session
	return b.Runtime != nil && b.ProviderSessionID != nil && *b.ProviderSessionID == session &&
		*d.rememberedSession == session && b.Runtime.PID == pid && b.Runtime.StartIdentity == start
}

func (d digestRecipient) activity() *launchActivity {
	a := d.state.Activity
	if a != nil && core.DigestPhase(a.State).Valid() && safeTime(a.SinceMs) && safeTime(a.LastActivityMs) &&
		a.LastActivityMs >= a.SinceMs && d.matchesSession(a.Session, a.PID, a.Start) {
		return a
	}
	return nil
}

func (d digestRecipient) canReportIdle() bool {
	if d.binding == nil {
		return true
	}
	if d.binding.Session.PlainProgram != nil {
		return false
	}
	if d.activity() != nil {
		return true
	}
	if d.driver == nil {
		return false
	}
	switch *d.driver {
	case core.DriverClaude, core.DriverCodex, "agy":
		return true
	case "pi":
		missing := d.state.NoStartupIdle
		return d.binding.Session.LaunchOwner != nil && (missing == nil || !d.matchesSession(missing.Session, missing.PID, missing.Start))
	default:
		return false
	}
}
