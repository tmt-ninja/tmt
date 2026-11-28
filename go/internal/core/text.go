package core

// ecmascriptSpace matches the ECMAScript whitespace and line terminators
// shared by identity names and profile text. BOM is included and NEL is excluded.
func ecmascriptSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680',
		'\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff':
		return true
	default:
		return r >= '\u2000' && r <= '\u200a'
	}
}
