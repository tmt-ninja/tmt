package core

type EndpointKey struct {
	Host     string
	ServerID string
	PaneID   string
}

type ServerEvidence struct {
	Host      string
	ID        string
	Socket    string
	PID       uint64
	StartTime string
}

type ProcessIncarnation struct {
	PID           uint64
	StartIdentity string
}

type BindingSessionState struct {
	RuntimeState      string
	LastTransition    *string
	Runtime           *ProcessIncarnation
	ProviderSessionID *string
	LaunchOwner       *ProcessIncarnation
	StartRefusal      *string
	PlainProgram      *string
}

// Binding is recorded ownership. A live probe is needed to route to its pane.
type Binding struct {
	ID              BindingID
	IdentityID      IdentityID
	Server          ServerEvidence
	PaneID          string
	PanePID         uint64
	PaneIncarnation *string
	Session         BindingSessionState
}

func (b Binding) EndpointKey() EndpointKey {
	return EndpointKey{Host: b.Server.Host, ServerID: b.Server.ID, PaneID: b.PaneID}
}

type BindingMarker struct {
	Name          Name
	CanonicalName string
	IdentityID    IdentityID
	BindingID     BindingID
	ServerID      string
	PanePID       uint64
}

func (b Binding) Marker(identity Identity) BindingMarker {
	return BindingMarker{
		Name:          identity.Name,
		CanonicalName: identity.CanonicalName,
		IdentityID:    identity.ID,
		BindingID:     b.ID,
		ServerID:      b.Server.ID,
		PanePID:       b.PanePID,
	}
}

type PaneObservation struct {
	ID          string
	PID         uint64
	Incarnation *string
	Marker      *BindingMarker
}

type EndpointProbeState uint8

const (
	EndpointProbeUnknown EndpointProbeState = iota
	EndpointProbeDead
	EndpointProbeLive
)

type EndpointProbe struct {
	State  EndpointProbeState
	Server ServerEvidence
	Panes  []PaneObservation
}

type BindingEvidence uint8

const (
	BindingUnknown BindingEvidence = iota
	BindingActive
	BindingEndpointLost
	BindingMarkerMismatch
)

// EvaluateBinding distinguishes proven endpoint loss from unknown state.
// A mismatched server ID or marker alone cannot prove process death.
func EvaluateBinding(identity Identity, binding *Binding, probe EndpointProbe) (BindingEvidence, *PaneObservation) {
	if binding == nil {
		return BindingUnknown, nil
	}
	switch probe.State {
	case EndpointProbeDead:
		return BindingEndpointLost, nil
	case EndpointProbeLive:
		// Continue with the snapshot supplied by the host.
	default:
		return BindingUnknown, nil
	}

	server := binding.Server
	if probe.Server.Host != server.Host || probe.Server.Socket != server.Socket {
		return BindingUnknown, nil
	}
	if probe.Server.PID != server.PID || probe.Server.StartTime != server.StartTime {
		return BindingEndpointLost, nil
	}
	if probe.Server.ID != server.ID {
		return BindingUnknown, nil
	}
	for _, pane := range probe.Panes {
		if pane.ID != binding.PaneID {
			continue
		}
		if pane.PID != binding.PanePID || IncarnationsDiffer(binding.PaneIncarnation, pane.Incarnation) {
			return BindingEndpointLost, nil
		}
		if !validBindingMarker(identity.ID, binding, pane.Marker) {
			return BindingMarkerMismatch, nil
		}
		return BindingActive, &pane
	}
	return BindingEndpointLost, nil
}

// IncarnationsDiffer requires two known and different start tokens.
func IncarnationsDiffer(recorded, observed *string) bool {
	return recorded != nil && observed != nil && *recorded != *observed
}

func validBindingMarker(identity IdentityID, binding *Binding, marker *BindingMarker) bool {
	if marker == nil || binding.IdentityID != identity || marker.IdentityID != identity ||
		marker.BindingID != binding.ID || marker.ServerID != binding.Server.ID || marker.PanePID != binding.PanePID {
		return false
	}
	// A consistent old marker name survives a rename. IDs establish ownership.
	name, err := ValidateExistingName(string(marker.Name))
	return err == nil && name.CanonicalName() == marker.CanonicalName
}

// BindingReservation owns a future binding while its marker is published and
// verified. The old binding remains active until the reservation is activated.
type BindingReservation struct {
	Target            Binding
	OldBindingID      *BindingID
	ExpectedBindingID *BindingID
	Publisher         ProcessIncarnation
	CreatedAtMs       uint64
	ExpiresAtMs       uint64
}

type LaunchTransition string

const (
	LaunchTransitionStarted LaunchTransition = "started"
	LaunchTransitionResumed LaunchTransition = "resumed"
)
