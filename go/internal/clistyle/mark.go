package clistyle

// Mark is a glyph with one shared meaning across command output.
type Mark uint8

const (
	MarkRunning Mark = iota
	MarkOffline
	MarkIdle
	MarkResumable
	MarkDone
	MarkFailed
	MarkWarning
	MarkDecision
)

var marks = [...]struct {
	symbol, description string
	token               Token
}{
	MarkRunning:   {"●", "running or active", TokenAccent},
	MarkOffline:   {"○", "offline or ended", TokenDim},
	MarkIdle:      {"◌", "bound to a pane, no agent running", TokenDim},
	MarkResumable: {"↻", "leads a resume action, never a row's state", TokenAccent},
	MarkDone:      {"✓", "done", TokenOK},
	MarkFailed:    {"✗", "failed or blocked", TokenError},
	MarkWarning:   {"!", "warning", TokenWarn},
	MarkDecision:  {"◆", "waits on your decision", TokenAccent},
}

func (mark Mark) Symbol() string {
	return marks[mark].symbol
}

func (mark Mark) Description() string {
	return marks[mark].description
}

func (mark Mark) Token() Token {
	return marks[mark].token
}
