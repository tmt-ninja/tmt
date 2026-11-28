package core

// DriverName is a provider admitted by the Phase 1 launch adapters.
type DriverName string

const (
	DriverClaude DriverName = "claude"
	DriverCodex  DriverName = "codex"
	DriverGemini DriverName = "gemini"
)

func (d DriverName) Valid() bool {
	switch d {
	case DriverClaude, DriverCodex, DriverGemini:
		return true
	default:
		return false
	}
}
