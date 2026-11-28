//go:build nativecompat

package flavor

// NativeCompatible reports the native-compatible build.
const NativeCompatible = true

const (
	Binary          = "tmt"
	EnvHome         = "TMT_HOME"
	DatabaseName    = "tmt.db"
	WorkspaceFile   = "tmt.json"
	OptionNamespace = "@tmt."
)

// DefaultRoot is native's global root below the user's home
// ($XDG_CONFIG_HOME/tmt takes precedence; see home.Resolve).
var DefaultRoot = []string{".config", "tmt"}
