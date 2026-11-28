package hostgrammar

import (
	"fmt"
	"strings"
)

const (
	nameMax   = 32
	prefixMax = 16
	suffixMax = 64
	targetMax = 32
	digitsMax = 9
)

// GrammarError reports an invalid host, target, or launch template declaration.
type GrammarError struct {
	message string
}

// NewGrammarError constructs a GrammarError with the given message.
func NewGrammarError(message string) *GrammarError {
	return &GrammarError{message: message}
}

func (e *GrammarError) Error() string {
	return e.message
}

type tokenKind uint8

const (
	tokenLiteral tokenKind = iota
	tokenNumber
)

type token struct {
	kind    tokenKind
	literal byte
}

// HostGrammar is a host's validated name, pane-ID prefix, and optional target syntax.
type HostGrammar struct {
	name      string
	prefix    string
	hasTarget bool
	target    []token
}

// New validates and constructs a HostGrammar.
// name is the stored host token, prefix starts every pane ID, and target is the optional
// template users name panes with (e.g. "w{n}:p{n}"). Pass nil for target when untargeted.
func New(name, prefix string, target *string) (*HostGrammar, error) {
	if !ValidName(name) {
		return nil, NewGrammarError("name must be a lowercase letter then up to 31 of [a-z0-9-]")
	}
	// A prefix ends in '_' or '-' and a suffix has neither, so a pane ID
	// has exactly one prefix: two different prefixes never share an ID.
	if !validPrefix(prefix) {
		return nil, NewGrammarError("paneId.prefix must be 2-16 of [a-z0-9_-], start with a letter and end in _ or -")
	}
	g := &HostGrammar{
		name:   name,
		prefix: prefix,
	}
	if target != nil {
		tokens, err := parseTemplate(*target)
		if err != nil {
			return nil, err
		}
		g.hasTarget = true
		g.target = tokens
	}
	return g, nil
}

// Name returns the validated host name.
func (g *HostGrammar) Name() string {
	return g.name
}

// PaneIDPrefix returns the validated pane-ID prefix.
func (g *HostGrammar) PaneIDPrefix() string {
	return g.prefix
}

// IsPaneID reports whether value matches this host's pane-ID syntax.
func (g *HostGrammar) IsPaneID(value string) bool {
	suffix, ok := strings.CutPrefix(value, g.prefix)
	return ok && validSuffix(suffix)
}

// IsTarget reports whether value matches this host's declared target syntax.
func (g *HostGrammar) IsTarget(value string) bool {
	if !g.hasTarget {
		return false
	}
	return matchTokens(g.target, value)
}

// SampleTarget returns a target with every number set to "1", for comparing syntaxes.
func (g *HostGrammar) SampleTarget() (string, bool) {
	return g.TargetNumbered("1")
}

// TargetNumbered returns a target with every number replaced by digits.
func (g *HostGrammar) TargetNumbered(digits string) (string, bool) {
	if !g.hasTarget {
		return "", false
	}
	var b strings.Builder
	for _, tok := range g.target {
		switch tok.kind {
		case tokenLiteral:
			b.WriteByte(tok.literal)
		case tokenNumber:
			b.WriteString(digits)
		}
	}
	return b.String(), true
}

// Conflict explains why two hosts cannot be installed together: the same name,
// the same pane-ID prefix, or targets one of them would read as its own.
func (g *HostGrammar) Conflict(other *HostGrammar) (string, bool) {
	if g.name == other.name {
		return fmt.Sprintf("both are named %s", g.name), true
	}
	if g.prefix == other.prefix {
		return fmt.Sprintf("both use the pane-ID prefix %s", g.prefix), true
	}
	reads := func(one, two *HostGrammar) bool {
		sample, ok := one.SampleTarget()
		return ok && two.IsTarget(sample)
	}
	if reads(g, other) || reads(other, g) {
		return fmt.Sprintf("%s and %s targets look alike", g.name, other.name), true
	}
	return "", false
}

// HostName is a validated host name, comparable and ordered as text.
type HostName string

// NewHostName returns a HostName if ValidName(name) holds.
func NewHostName(name string) (HostName, bool) {
	if !ValidName(name) {
		return "", false
	}
	return HostName(name), true
}

func (n HostName) String() string {
	return string(n)
}

func isASCIILower(b byte) bool {
	return b >= 'a' && b <= 'z'
}

func isASCIIUpper(b byte) bool {
	return b >= 'A' && b <= 'Z'
}

func isASCIIDigit(b byte) bool {
	return b >= '0' && b <= '9'
}

func validPrefix(prefix string) bool {
	if len(prefix) < 2 || len(prefix) > prefixMax {
		return false
	}
	if !isASCIILower(prefix[0]) {
		return false
	}
	last := prefix[len(prefix)-1]
	if last != '_' && last != '-' {
		return false
	}
	for i := 0; i < len(prefix); i++ {
		c := prefix[i]
		if !(isASCIILower(c) || isASCIIDigit(c) || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

func validSuffix(suffix string) bool {
	if len(suffix) < 1 || len(suffix) > suffixMax {
		return false
	}
	for i := 0; i < len(suffix); i++ {
		c := suffix[i]
		if !(isASCIIDigit(c) || isASCIILower(c)) {
			return false
		}
	}
	return true
}

// HasPaneIDShape reports whether some declarable host syntax could read value as a pane ID:
// a valid prefix, then a valid suffix. It says nothing about which host or whether one is approved.
func HasPaneIDShape(value string) bool {
	end := strings.LastIndexAny(value, "_-")
	if end < 0 {
		return false
	}
	return validPrefix(value[:end+1]) && validSuffix(value[end+1:])
}

// ValidName reports whether name is a valid host name, the token stored with a binding.
func ValidName(name string) bool {
	if len(name) < 1 || len(name) > nameMax {
		return false
	}
	if !isASCIILower(name[0]) {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		if !(isASCIILower(c) || isASCIIDigit(c) || c == '-') {
			return false
		}
	}
	return true
}

// Literals are [a-z:] and the template starts with a letter, so a target is never a number,
// a pane ID of any host, or tmux's window.pane. A number is 1-9 of [0-9A-Z], which no literal is.
func parseTemplate(template string) ([]token, error) {
	errInvalid := func() error {
		return NewGrammarError("target must be up to 32 of [a-z:] and {n}, start with a letter and hold at least one {n}")
	}
	if len(template) == 0 || len(template) > targetMax || !isASCIILower(template[0]) {
		return nil, errInvalid()
	}
	var tokens []token
	hasNumber := false
	rest := template
	for len(rest) > 0 {
		if after, ok := strings.CutPrefix(rest, "{n}"); ok {
			// Two numbers in a row would have no boundary between them.
			if len(tokens) > 0 && tokens[len(tokens)-1].kind == tokenNumber {
				return nil, errInvalid()
			}
			tokens = append(tokens, token{kind: tokenNumber})
			hasNumber = true
			rest = after
		} else if isASCIILower(rest[0]) || rest[0] == ':' {
			tokens = append(tokens, token{kind: tokenLiteral, literal: rest[0]})
			rest = rest[1:]
		} else {
			return nil, errInvalid()
		}
	}
	if !hasNumber {
		return nil, errInvalid()
	}
	return tokens, nil
}

func matchTokens(tokens []token, value string) bool {
	rest := value
	for _, tok := range tokens {
		switch tok.kind {
		case tokenLiteral:
			if len(rest) == 0 || rest[0] != tok.literal {
				return false
			}
			rest = rest[1:]
		case tokenNumber:
			// A host may number in a base above ten (Herdr's p2E). No
			// literal is uppercase, so a number ends at the next literal.
			digits := 0
			for digits < len(rest) && (isASCIIDigit(rest[digits]) || isASCIIUpper(rest[digits])) {
				digits++
			}
			if digits < 1 || digits > digitsMax {
				return false
			}
			rest = rest[digits:]
		}
	}
	return len(rest) == 0
}
