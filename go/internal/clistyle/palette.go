package clistyle

// Terminal is the output stream's presentation state. A nil Width means the
// renderer has no terminal width. The zero value is plain, unbounded output.
type Terminal struct {
	Width *int
	Depth Depth
	Theme *Theme
}

// Token gives common output elements a consistent style.
type Token uint8

const (
	TokenPlain Token = iota
	TokenAccent
	TokenOK
	TokenWarn
	TokenError
	TokenDim
	TokenTitle
	TokenLiteral
	tokenDriverDim
	tokenDriverFirst
)

// DriverToken selects a driver's declared design role, or dim for an
// undeclared hue.
func DriverToken(role *Role) Token {
	if role == nil || int(*role) >= len(roleStyles) {
		return tokenDriverDim
	}
	return tokenDriverFirst + Token(*role)
}

// Paint applies one semantic style. Escape untrusted display text before
// painting it.
func (term Terminal) Paint(token Token, text string) string {
	if term.Depth == NoColor || text == "" {
		return text
	}
	if token >= tokenDriverFirst {
		role := Role(token - tokenDriverFirst)
		if term.Theme != nil {
			return term.Theme.Paint(role, term.Depth, text)
		}
		switch role {
		case RoleAccent, RoleUnread, RoleMatrixBatch, RoleMatrixUrgent, RoleWorking,
			RoleWaiting, RoleBlocked, RoleReview, RoleLink:
			return (Theme{Base: ThemeTerminal}).Paint(role, ANSI16, text)
		}
		return text
	}
	switch token {
	case TokenTitle, TokenLiteral:
		return paintSGR(1, text)
	case TokenAccent, TokenOK, TokenWarn, TokenError, TokenDim, tokenDriverDim:
		role := [...]Role{TokenAccent: RoleAccent, TokenOK: RoleWorking, TokenWarn: RoleWaiting,
			TokenError: RoleBlocked, TokenDim: RoleDim, tokenDriverDim: RoleDim}[token]
		if term.Theme != nil {
			return term.Theme.Paint(role, term.Depth, text)
		}
		return (Theme{Base: ThemeTerminal}).Paint(role, ANSI16, text)
	default:
		return text
	}
}
