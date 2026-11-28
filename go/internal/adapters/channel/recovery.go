//go:build darwin || linux

package channel

import (
	"context"
	"errors"
	"fmt"
	"io/fs"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

var (
	ErrRecoveryID             = errors.New("channel recovery requires UUID binding and generation")
	ErrEnrollmentChanged      = errors.New("channel enrollment changed")
	ErrEnrollmentLive         = errors.New("channel enrollment is live")
	ErrEnrollmentUnverifiable = errors.New("channel enrollment is unverifiable")
	ErrRecoveryFailed         = errors.New("channel recovery failed")
)

type EnrollmentState string

const (
	EnrollmentRunning      EnrollmentState = "running"
	EnrollmentUnverifiable EnrollmentState = "unverifiable"
	EnrollmentUnconfirmed  EnrollmentState = "unconfirmed"
	EnrollmentEnded        EnrollmentState = "ended"
)

type EnrollmentProcess struct {
	Role  string `json:"role"`
	PID   uint64 `json:"pid"`
	Start string `json:"start"`
	State string `json:"state"`
}

// EnrollmentReport describes what the record proves and what recovery would
// change. The recovery command is nil when the record cannot be recovered.
type EnrollmentReport struct {
	Driver             string              `json:"driver"`
	Record             string              `json:"record"`
	IdentityID         *string             `json:"identityId"`
	Generation         string              `json:"generation"`
	State              EnrollmentState     `json:"state"`
	Pane               *paneRecord         `json:"pane"`
	Processes          []EnrollmentProcess `json:"processes"`
	ForegroundRecorded bool                `json:"foregroundRecorded"`
	Verification       string              `json:"verification"`
	Removes            []string            `json:"removes"`
	Keeps              []string            `json:"keeps"`
	Recover            *string             `json:"recover"`
}

type RecoveryResult struct {
	BindingID  string    `json:"bindingId"`
	Generation string    `json:"generation"`
	Driver     string    `json:"driver,omitempty"`
	Recovered  bool      `json:"recovered"`
	Removed    []string  `json:"removed,omitempty"`
	Kept       *[]string `json:"kept,omitempty"`
}

// InspectClaude reads an exact enrollment and never creates the lock file.
func InspectClaude(ctx context.Context, runner ports.Process, root home.Root, bindingID string) (*EnrollmentReport, error) {
	if !core.ValidUUID(bindingID) {
		return nil, ErrRecoveryID
	}
	ctx, cancel := context.WithTimeout(ctx, evidenceBudget)
	defer cancel()
	dir, record, err := readEnrollment(root, bindingID)
	if dir != nil {
		defer dir.close()
	}
	if err != nil || record == nil {
		return nil, err
	}
	report := enrollmentReport(ctx, runner, root, dir, *record)
	return &report, nil
}

// RecoverClaude removes a named enrollment only after observing all of its
// recorded incarnations gone and comparing the entire record under the lock.
// Naming an unconfirmed generation certifies the caller checked its provider.
func RecoverClaude(ctx context.Context, runner ports.Process, root home.Root, bindingID, generation string) (RecoveryResult, error) {
	result := RecoveryResult{BindingID: bindingID, Generation: generation}
	if !core.ValidUUID(bindingID) || !core.ValidUUID(generation) {
		return result, ErrRecoveryID
	}
	ctx, cancel := context.WithTimeout(ctx, evidenceBudget)
	defer cancel()
	dir, record, err := readEnrollment(root, bindingID)
	if dir != nil {
		defer dir.close()
	}
	if err != nil || record == nil {
		return result, err
	}
	if record.Generation != generation {
		return result, ErrEnrollmentChanged
	}
	switch enrollmentReport(ctx, runner, root, dir, *record).State {
	case EnrollmentRunning:
		return result, ErrEnrollmentLive
	case EnrollmentUnverifiable:
		return result, ErrEnrollmentUnverifiable
	}
	lock, err := dir.lock(ctx)
	if err != nil {
		return result, errors.Join(ErrRecoveryFailed, err)
	}
	defer lock.Close()
	current, err := dir.readClaude(bindingID)
	if err != nil || current != nil && !sameRecord(*current, *record) {
		return result, ErrEnrollmentChanged
	}
	if current == nil {
		return result, nil
	}
	if ctx.Err() != nil || checkChannelPath(dir, root) != nil {
		return result, ErrRecoveryFailed
	}
	// Remove the socket first so a failed unlink retains the evidence needed
	// for a retry. A regular file or symlink at the socket name stays put.
	removes, keeps, err := recoveryPaths(root, dir, bindingID)
	if err != nil {
		return result, errors.Join(ErrRecoveryFailed, err)
	}
	if len(removes) > 1 {
		if err := dir.root.Remove(bindingID + ".sock"); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return result, errors.Join(ErrRecoveryFailed, err)
		}
	}
	if err := dir.root.Remove(bindingID + ".json"); err != nil {
		return result, errors.Join(ErrRecoveryFailed, err)
	}
	result.Driver, result.Recovered, result.Removed, result.Kept = "claude", true, removes, &keeps
	return result, nil
}

func readEnrollment(root home.Root, bindingID string) (*channelDir, *claudeRecord, error) {
	dir, err := openChannelDir(root, false)
	if errors.Is(err, errNoChannelDirectory) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, &EvidenceError{Fault: ChannelUnverifiable, Path: ClaudeDirectory(root)}
	}
	record, err := dir.readClaude(bindingID)
	if err != nil {
		return dir, nil, invalidRecord(root, bindingID)
	}
	return dir, record, nil
}

func enrollmentReport(ctx context.Context, runner ports.Process, root home.Root, dir *channelDir, record claudeRecord) EnrollmentReport {
	report := EnrollmentReport{
		Driver: "claude", Record: recordPath(root, record.BindingID), Generation: record.Generation,
		Pane: record.Pane, ForegroundRecorded: record.foregroundRecorded(), State: EnrollmentEnded,
	}
	if record.IdentityID != "" {
		report.IdentityID = &record.IdentityID
	}
	if !report.ForegroundRecorded {
		report.State = EnrollmentUnconfirmed
	}
	observer := runtime.Observer{Process: runner}
	for _, entry := range record.processes() {
		state := "unobservable"
		switch observeRecorded(ctx, observer, entry.process) {
		case runtime.Alive, runtime.Suspended:
			state = "running"
			report.State = EnrollmentRunning
		case runtime.Gone:
			state = "gone"
		default:
			if report.State != EnrollmentRunning {
				report.State = EnrollmentUnverifiable
			}
		}
		report.Processes = append(report.Processes, EnrollmentProcess{Role: entry.role, PID: entry.process.PID, Start: entry.process.Start, State: state})
	}
	report.Verification = "Every recorded process must be gone. Recovery leaves the pane and processes alone."
	if !report.ForegroundRecorded {
		location := "the pane where the launch ran"
		if record.Pane != nil {
			location = fmt.Sprintf("pane %s on %s", record.Pane.PaneID, record.Pane.SocketPath)
		}
		report.Verification = fmt.Sprintf("Before recovering, confirm that no provider process started by launch owner %d (started %s) still runs in %s.",
			record.LaunchOwner.PID, record.LaunchOwner.Start, location)
	}
	var err error
	report.Removes, report.Keeps, err = recoveryPaths(root, dir, record.BindingID)
	if err == nil && ctx.Err() == nil && (report.State == EnrollmentEnded || report.State == EnrollmentUnconfirmed) {
		command := recoverCommand(record.BindingID, record.Generation)
		report.Recover = &command
	}
	return report
}

func recoveryPaths(root home.Root, dir *channelDir, bindingID string) ([]string, []string, error) {
	removes := []string{recordPath(root, bindingID)}
	keeps := []string{}
	info, err := dir.root.Lstat(bindingID + ".sock")
	if errors.Is(err, fs.ErrNotExist) {
		return removes, keeps, nil
	}
	if err != nil {
		return removes, keeps, err
	}
	if info.Mode()&fs.ModeSocket != 0 && sys.FileOwnedByEffectiveUser(info) {
		removes = append(removes, socketPath(root, bindingID))
	} else {
		keeps = append(keeps, socketPath(root, bindingID))
	}
	return removes, keeps, nil
}

func sameRecord(a, b claudeRecord) bool {
	return sameClaudeEnrollment(a, b) && sameProcess(a.Foreground, b.Foreground) && sameProcess(a.Claude, b.Claude)
}

func sameProcess(a, b *processRecord) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
