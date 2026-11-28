//go:build !nativecompat

package flavor

// NativeCompatible reports the native-compatible build.
const NativeCompatible = false

const (
	Binary          = "tmt-go"      // printed command name and executable base name
	EnvHome         = "TMT_GO_HOME" // variable that selects the data root
	DatabaseName    = "tmt-go.db"   // store file inside the root
	WorkspaceFile   = "tmt-go.json" // workspace settings file
	OptionNamespace = "@tmt-go."    // tmux user-option prefix
)

// DefaultRoot is the data root below the user's home when EnvHome is unset.
var DefaultRoot = []string{".local", "share", "tmt-go"}
