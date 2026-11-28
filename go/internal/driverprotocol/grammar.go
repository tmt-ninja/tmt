package driverprotocol

import (
	"fmt"
	"slices"
	"strings"
	"unicode"

	"github.com/tmt-ninja/tmt/go/internal/hostgrammar"
)

// Re-exported hostgrammar types used by callers of driverprotocol.
type (
	GrammarError   = hostgrammar.GrammarError
	HostGrammar    = hostgrammar.HostGrammar
	LaunchTemplate = hostgrammar.LaunchTemplate
)

const (
	envMax     = 4
	envNameMax = 64
)

// Grammar is a host driver's validated declaration.
type Grammar struct {
	host      *hostgrammar.HostGrammar
	callerEnv []string
	launch    *hostgrammar.LaunchTemplate
}

// GrammarFromCapabilities validates capabilities and returns its Grammar.
func GrammarFromCapabilities(capabilities *Capabilities) (*Grammar, error) {
	host, err := hostgrammar.New(capabilities.Name, capabilities.PaneID.Prefix, capabilities.Target)
	if err != nil {
		return nil, err
	}
	if len(capabilities.CallerEnv) > envMax {
		return nil, hostgrammar.NewGrammarError("callerEnv names at most 4 variables")
	}
	for _, variable := range capabilities.CallerEnv {
		if !validEnvName(variable) {
			return nil, hostgrammar.NewGrammarError(fmt.Sprintf(
				"callerEnv entry %q must be [A-Z][A-Z0-9_]* and not TMT_*",
				variable,
			))
		}
	}
	var launch *hostgrammar.LaunchTemplate
	if capabilities.Launch != nil {
		tmpl, err := hostgrammar.NewLaunchTemplate(*capabilities.Launch)
		if err != nil {
			return nil, hostgrammar.NewGrammarError(fmt.Sprintf("launch: %s", err.Error()))
		}
		launch = tmpl
	}
	return &Grammar{
		host:      host,
		callerEnv: slices.Clone(capabilities.CallerEnv),
		launch:    launch,
	}, nil
}

// Host returns the underlying HostGrammar for core's host registry.
func (g *Grammar) Host() *hostgrammar.HostGrammar { return g.host }

// Name returns the host name.
func (g *Grammar) Name() string { return g.host.Name() }

// CallerEnv returns a copy of the declared caller environment variables.
func (g *Grammar) CallerEnv() []string { return slices.Clone(g.callerEnv) }

// Launch returns the host's default launch template, or nil if none was published.
func (g *Grammar) Launch() *hostgrammar.LaunchTemplate { return g.launch }

// PaneIDPrefix returns the declared pane-ID prefix.
func (g *Grammar) PaneIDPrefix() string { return g.host.PaneIDPrefix() }

// IsPaneID reports whether value matches the declared pane-ID syntax.
func (g *Grammar) IsPaneID(value string) bool { return g.host.IsPaneID(value) }

// IsTarget reports whether value matches the declared target syntax.
func (g *Grammar) IsTarget(value string) bool { return g.host.IsTarget(value) }

// SampleTarget returns a target with every number set to "1".
func (g *Grammar) SampleTarget() (string, bool) { return g.host.SampleTarget() }

// TargetNumbered returns a target with every number replaced by digits.
func (g *Grammar) TargetNumbered(digits string) (string, bool) {
	return g.host.TargetNumbered(digits)
}

// Conflict explains why two drivers cannot be installed together.
func (g *Grammar) Conflict(other *Grammar) (string, bool) { return g.host.Conflict(other.host) }

func validEnvName(name string) bool {
	if len(name) < 1 || len(name) > envNameMax {
		return false
	}
	if name[0] < 'A' || name[0] > 'Z' {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		if !((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}
	return !strings.HasPrefix(name, "TMT_")
}

// plain reports whether value is within maxBytes and free of control characters.
func plain(value string, maxBytes int) bool {
	if len(value) > maxBytes {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// validSocket reports whether value is an absolute path (>1 byte) without control characters.
func validSocket(value string) bool {
	return strings.HasPrefix(value, "/") && len(value) > 1 && plain(value, 1024)
}

// validPID reports whether value is a positive process ID fitting JS safe integers (< 2^53).
func validPID(value uint64) bool {
	return value > 0 && value < (1<<53)
}

// uuidShaped reports whether value is a lowercase hyphenated UUID.
func uuidShaped(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i := 0; i < 36; i++ {
		c := value[i]
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
				return false
			}
		}
	}
	return true
}
