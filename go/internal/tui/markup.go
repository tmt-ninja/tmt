package tui

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

const (
	MaxBytes = 256 * 1024
	MaxDepth = 32
	MaxNodes = 20_000
)

// Kind identifies an admitted TMT markup element.
type Kind uint8

const (
	KindView Kind = iota
	KindRow
	KindCol
	KindCell
	KindText
	KindRepeat
	KindModal
	KindScroll
	KindKeyHelp
	KindList
	KindTable
	KindPicker
	// KindSwitch is width-conditional layout: exactly one Case/Default branch is laid out.
	KindSwitch
	KindCase
	KindDefault
)

// Location is a 1-based line and column in a markup source file.
type Location struct {
	Line   uint32
	Column uint32
}

// MarkupError is a located admission or binding error.
type MarkupError struct {
	File     string
	Location Location
	Message  string
}

func (e *MarkupError) Error() string {
	return fmt.Sprintf("%s:%d:%d: %s", e.File, e.Location.Line, e.Location.Column, e.Message)
}

// MarkupElement is a statically admitted XML template element.
type MarkupElement struct {
	Kind       Kind
	Style      CellStyle
	Attributes map[string]string
	Text       string
	Children   []MarkupElement
	Location   Location
}

type breakpointSpec struct {
	name  string
	cells uint16
}

var breakpoints = [3]breakpointSpec{
	{name: "sm", cells: clistyle.SmallWidth},
	{name: "md", cells: clistyle.MediumWidth},
	{name: "lg", cells: clistyle.LargeWidth},
}

func parseBreakpoint(name string) (breakpointSpec, error) {
	for _, bp := range breakpoints {
		if bp.name == name {
			return bp, nil
		}
	}
	return breakpointSpec{}, fmt.Errorf("expected a breakpoint name (sm, md, lg)")
}

func lineColAt(source string, offset int) Location {
	if offset > len(source) {
		offset = len(source)
	}
	var line uint32 = 1
	var col uint32 = 1
	for _, r := range source[:offset] {
		if r == '\n' {
			line++
			col = 1
		} else {
			col++
		}
	}
	return Location{Line: line, Column: col}
}

type posCursor struct {
	offset int
	loc    Location
}

func (c *posCursor) advanceTo(source string, target int) Location {
	if target < c.offset {
		return lineColAt(source, target)
	}
	if target > len(source) {
		target = len(source)
	}
	for _, r := range source[c.offset:target] {
		if r == '\n' {
			c.loc.Line++
			c.loc.Column = 1
		} else {
			c.loc.Column++
		}
	}
	c.offset = target
	return c.loc
}

// Parse admits version 1 markup structure, including templates that may later
// repeat zero times. No I/O occurs.
func Parse(file, source string) (*MarkupElement, error) {
	if len(source) > MaxBytes {
		return nil, &MarkupError{
			File:     file,
			Location: Location{Line: 1, Column: 1},
			Message:  "layout exceeds 256 KiB",
		}
	}
	if err := checkDepth(file, source); err != nil {
		return nil, err
	}

	dec := xml.NewDecoder(strings.NewReader(source))
	dec.Strict = true
	dec.Entity = map[string]string{}

	nodes := 1 // document node
	cursor := &posCursor{offset: 0, loc: Location{Line: 1, Column: 1}}

	var root *MarkupElement
	for {
		prevOffset := int(dec.InputOffset())
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			loc := lineColAt(source, int(dec.InputOffset()))
			return nil, &MarkupError{File: file, Location: loc, Message: err.Error()}
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if root != nil {
				loc := cursor.advanceTo(source, findTagStart(source, prevOffset))
				return nil, &MarkupError{File: file, Location: loc, Message: "multiple root elements"}
			}
			nodes++
			if nodes > MaxNodes {
				loc := cursor.advanceTo(source, findTagStart(source, prevOffset))
				return nil, &MarkupError{File: file, Location: loc, Message: "nodes limit exceeded"}
			}
			elemStart := findTagStart(source, prevOffset)
			loc := cursor.advanceTo(source, elemStart)
			if t.Name.Local != "tmt-view" || t.Name.Space != "" || !hasAttrValue(t.Attr, "version", "1") {
				return nil, &MarkupError{
					File:     file,
					Location: loc,
					Message:  `root must be <tmt-view version="1">`,
				}
			}
			el, err := readElement(file, source, dec, t, loc, true, cursor, &nodes)
			if err != nil {
				return nil, err
			}
			root = &el
		case xml.CharData:
			if len(bytes.TrimSpace(t)) > 0 {
				loc := lineColAt(source, prevOffset)
				return nil, &MarkupError{File: file, Location: loc, Message: "unexpected text outside root element"}
			}
		case xml.Comment:
			nodes++
			if nodes > MaxNodes {
				return nil, &MarkupError{File: file, Location: lineColAt(source, prevOffset), Message: "nodes limit exceeded"}
			}
		case xml.ProcInst:
			if t.Target != "xml" {
				nodes++
				if nodes > MaxNodes {
					return nil, &MarkupError{File: file, Location: lineColAt(source, prevOffset), Message: "nodes limit exceeded"}
				}
			}
		case xml.Directive:
			return nil, &MarkupError{
				File:     file,
				Location: lineColAt(source, prevOffset),
				Message:  "XML declarations such as DOCTYPE are not allowed",
			}
		}
	}
	if root == nil {
		return nil, &MarkupError{
			File:     file,
			Location: Location{Line: 1, Column: 1},
			Message:  `root must be <tmt-view version="1">`,
		}
	}
	return root, nil
}

func findTagStart(source string, from int) int {
	i := from
	for i < len(source) {
		idx := strings.IndexByte(source[i:], '<')
		if idx < 0 {
			return from
		}
		i += idx
		tail := source[i:]
		switch {
		case strings.HasPrefix(tail, "<!--"):
			end := strings.Index(tail, "-->")
			if end < 0 {
				return i
			}
			i += end + 3
		case strings.HasPrefix(tail, "<![CDATA["):
			end := strings.Index(tail, "]]>")
			if end < 0 {
				return i
			}
			i += end + 3
		case strings.HasPrefix(tail, "<?"):
			end := strings.Index(tail, "?>")
			if end < 0 {
				return i
			}
			i += end + 2
		default:
			return i
		}
	}
	return from
}

func hasAttrValue(attrs []xml.Attr, name, want string) bool {
	for _, a := range attrs {
		if a.Name.Space == "" && a.Name.Local == name && a.Value == want {
			return true
		}
	}
	return false
}

// checkDepth is a bounded lexical preflight counting open tags before xml.Decoder
// allocates a tree, ignoring quoted attributes, comments, CDATA, and PIs.
// Declarations are refused here before any entity can expand.
func checkDepth(file, source string) error {
	offset := 0
	depth := 0
	for {
		rel := strings.IndexByte(source[offset:], '<')
		if rel < 0 {
			return nil
		}
		offset += rel
		tail := source[offset:]
		fail := func(msg string) error {
			return &MarkupError{
				File:     file,
				Location: lineColAt(source, offset),
				Message:  msg,
			}
		}
		var delim string
		switch {
		case strings.HasPrefix(tail, "<!--"):
			delim = "-->"
		case strings.HasPrefix(tail, "<![CDATA["):
			delim = "]]>"
		case strings.HasPrefix(tail, "<?"):
			delim = "?>"
		}
		if delim != "" {
			end := strings.Index(tail, delim)
			if end < 0 {
				return nil
			}
			offset += end + len(delim)
			continue
		}
		if strings.HasPrefix(tail, "<!") {
			return fail("XML declarations such as DOCTYPE are not allowed")
		}
		closing := strings.HasPrefix(tail, "</")
		end := offset + 1
		var quote byte
		for end < len(source) {
			b := source[end]
			if quote != 0 {
				if b == quote {
					quote = 0
				}
			} else {
				if b == '\'' || b == '"' {
					quote = b
				} else if b == '>' {
					break
				}
			}
			end++
		}
		if end == len(source) {
			return nil
		}
		if closing {
			if depth > 0 {
				depth--
			}
		} else {
			if depth == MaxDepth {
				return fail("nesting exceeds 32 elements")
			}
			if source[end-1] != '/' {
				depth++
			}
		}
		offset = end + 1
	}
}

func readElement(
	file, source string,
	dec *xml.Decoder,
	se xml.StartElement,
	loc Location,
	isRoot bool,
	cursor *posCursor,
	nodes *int,
) (MarkupElement, error) {
	tagName := se.Name.Local
	fail := func(msg string) error {
		return &MarkupError{
			File:     file,
			Location: loc,
			Message:  fmt.Sprintf("<%s>: %s", tagName, msg),
		}
	}
	if se.Name.Space != "" {
		return MarkupElement{}, fail("XML namespaces are not allowed")
	}
	for _, a := range se.Attr {
		if a.Name.Local == "xmlns" || a.Name.Space == "xmlns" || a.Name.Space != "" {
			return MarkupElement{}, fail("XML namespaces are not allowed")
		}
	}

	var kind Kind
	switch tagName {
	case "tmt-view":
		if !isRoot {
			return MarkupElement{}, fail("unknown element or nested tmt-view")
		}
		kind = KindView
	case "tmt-row":
		kind = KindRow
	case "tmt-col":
		kind = KindCol
	case "tmt-cell":
		kind = KindCell
	case "tmt-text":
		kind = KindText
	case "tmt-repeat":
		kind = KindRepeat
	case "tmt-modal":
		kind = KindModal
	case "tmt-scroll":
		kind = KindScroll
	case "tmt-key-help":
		kind = KindKeyHelp
	case "tmt-list":
		kind = KindList
	case "tmt-table":
		kind = KindTable
	case "tmt-picker":
		kind = KindPicker
	case "tmt-switch":
		kind = KindSwitch
	case "tmt-case":
		kind = KindCase
	case "tmt-default":
		kind = KindDefault
	default:
		return MarkupElement{}, fail("unknown element or nested tmt-view")
	}

	leaf := kind == KindCell || kind == KindText
	attributes := make(map[string]string, len(se.Attr))
	for _, attr := range se.Attr {
		name := attr.Name.Local
		if _, dup := attributes[name]; dup {
			return MarkupElement{}, fail(fmt.Sprintf("duplicate attribute %s", name))
		}
		if !isAllowedAttr(kind, isRoot, leaf, name) {
			return MarkupElement{}, fail(fmt.Sprintf("attribute %s=%q is not allowed", name, attr.Value))
		}
		attributes[name] = attr.Value
	}

	for _, pair := range [][2]string{{"id", "id-bind"}, {"row-id", "row-bind"}, {"bind", "from"}} {
		_, hasA := attributes[pair[0]]
		_, hasB := attributes[pair[1]]
		if hasA && hasB {
			return MarkupElement{}, fail(fmt.Sprintf("use either %s or %s", pair[0], pair[1]))
		}
	}

	if kind == KindRepeat {
		for _, key := range []string{"each", "as"} {
			if strings.TrimSpace(attributes[key]) == "" {
				return MarkupElement{}, fail(fmt.Sprintf("repeat requires nonempty %s", key))
			}
		}
	}

	hideBelow, hasHideBelow := attributes["hide-below"]
	if hasHideBelow {
		delete(attributes, "hide-below")
	}

	switch kind {
	case KindSwitch:
		if of, ok := attributes["of"]; ok && of != "container" && of != "terminal" {
			return MarkupElement{}, fail(fmt.Sprintf("of=%q: expected container or terminal", of))
		}
	case KindCase:
		minAttr, ok := attributes["min"]
		if !ok {
			return MarkupElement{}, fail("requires min=<breakpoint>")
		}
		if _, err := parseBreakpoint(minAttr); err != nil {
			return MarkupElement{}, fail(fmt.Sprintf("min=%q: %s", minAttr, err.Error()))
		}
	}
	if hasHideBelow {
		if _, err := parseBreakpoint(hideBelow); err != nil {
			return MarkupElement{}, fail(fmt.Sprintf("hide-below=%q: %s", hideBelow, err.Error()))
		}
	}

	style, err := admitStyle(kind, attributes)
	if err != nil {
		return MarkupElement{}, fail(err.Error())
	}

	var textBuf strings.Builder
	var children []MarkupElement
	prevWasText := false

	for {
		prevOffset := int(dec.InputOffset())
		tok, err := dec.Token()
		if err != nil {
			return MarkupElement{}, &MarkupError{
				File:     file,
				Location: lineColAt(source, int(dec.InputOffset())),
				Message:  err.Error(),
			}
		}
		switch t := tok.(type) {
		case xml.EndElement:
			goto done
		case xml.CharData:
			if len(t) > 0 && !prevWasText {
				*nodes++
				if *nodes > MaxNodes {
					return MarkupElement{}, &MarkupError{File: file, Location: lineColAt(source, prevOffset), Message: "nodes limit exceeded"}
				}
				prevWasText = true
			}
			textBuf.Write(t)
		case xml.StartElement:
			prevWasText = false
			*nodes++
			if *nodes > MaxNodes {
				return MarkupElement{}, &MarkupError{File: file, Location: lineColAt(source, prevOffset), Message: "nodes limit exceeded"}
			}
			if leaf {
				return MarkupElement{}, fail("text/cell cannot contain elements")
			}
			childLoc := cursor.advanceTo(source, findTagStart(source, prevOffset))
			child, err := readElement(file, source, dec, t, childLoc, false, cursor, nodes)
			if err != nil {
				return MarkupElement{}, err
			}
			children = append(children, child)
		case xml.Comment:
			prevWasText = false
			*nodes++
			if *nodes > MaxNodes {
				return MarkupElement{}, &MarkupError{File: file, Location: lineColAt(source, prevOffset), Message: "nodes limit exceeded"}
			}
		case xml.ProcInst:
			prevWasText = false
			*nodes++
			if *nodes > MaxNodes {
				return MarkupElement{}, &MarkupError{File: file, Location: lineColAt(source, prevOffset), Message: "nodes limit exceeded"}
			}
		case xml.Directive:
			return MarkupElement{}, &MarkupError{
				File:     file,
				Location: lineColAt(source, prevOffset),
				Message:  "XML declarations such as DOCTYPE are not allowed",
			}
		}
	}

done:
	text := textBuf.String()
	_, hasBind := attributes["bind"]
	_, hasFrom := attributes["from"]
	if strings.TrimSpace(text) != "" && (!leaf || hasBind || hasFrom) {
		return MarkupElement{}, fail("literal text requires an unbound text/cell element")
	}

	if err := checkBranches(file, kind, loc, children); err != nil {
		return MarkupElement{}, err
	}

	element := MarkupElement{
		Kind:       kind,
		Style:      style,
		Attributes: attributes,
		Text:       text,
		Children:   children,
		Location:   loc,
	}

	if hasHideBelow {
		mkBranch := func(k Kind, attrs map[string]string, kids []MarkupElement) MarkupElement {
			st, _ := admitStyle(k, attrs)
			return MarkupElement{
				Kind:       k,
				Style:      st,
				Attributes: attrs,
				Children:   kids,
				Location:   loc,
			}
		}
		return mkBranch(
			KindSwitch,
			map[string]string{},
			[]MarkupElement{
				mkBranch(KindCase, map[string]string{"min": hideBelow}, []MarkupElement{element}),
				mkBranch(KindDefault, map[string]string{}, nil),
			},
		), nil
	}
	return element, nil
}

func isAllowedAttr(kind Kind, isRoot, leaf bool, name string) bool {
	if kind == KindRepeat {
		return name == "each" || name == "as"
	}
	if kind == KindSwitch || kind == KindCase || kind == KindDefault {
		return (kind == KindSwitch && name == "of") || (kind == KindCase && name == "min")
	}
	switch name {
	case "id", "id-bind", "class", "token", "selected":
		return true
	case "title", "placement":
		return kind == KindModal || kind == KindPicker
	case "bind":
		return kind == KindKeyHelp || kind == KindList || kind == KindTable || leaf
	case "heading-token", "heading-bold", "section-gap":
		return kind == KindKeyHelp
	case "as", "empty":
		return kind == KindList || kind == KindTable
	case "slot":
		return kind == KindText
	case "version":
		return isRoot
	case "row-id", "row-bind":
		return kind == KindRow
	case "column", "from", "format", "token-bind", "wrap":
		return leaf
	case "priority", "min-cols":
		return kind == KindCell
	case "hide-below":
		return kind == KindRow || kind == KindCol || kind == KindCell || kind == KindText
	default:
		return false
	}
}

func checkBranches(file string, kind Kind, location Location, children []MarkupElement) error {
	at := func(loc Location, msg string) error {
		return &MarkupError{File: file, Location: loc, Message: msg}
	}
	if kind != KindSwitch {
		for _, child := range children {
			if child.Kind == KindCase || child.Kind == KindDefault {
				return at(child.Location, "branches belong directly inside <tmt-switch>")
			}
		}
		return nil
	}
	var prev *breakpointSpec
	hasDefault := false
	for idx, child := range children {
		switch {
		case child.Kind == KindCase && !hasDefault:
			bp, _ := parseBreakpoint(child.Attributes["min"])
			if prev != nil && bp.cells >= prev.cells {
				return at(child.Location, fmt.Sprintf("<tmt-case min=%q> must come before %q; cases descend and never repeat", bp.name, prev.name))
			}
			bpCopy := bp
			prev = &bpCopy
		case child.Kind == KindDefault && idx+1 == len(children) && !hasDefault:
			hasDefault = true
		case child.Kind == KindCase || child.Kind == KindDefault:
			return at(child.Location, "<tmt-default> is the single last branch of a <tmt-switch>")
		default:
			return at(child.Location, "<tmt-switch> holds only <tmt-case> and <tmt-default>")
		}
	}
	if prev == nil {
		return at(location, "<tmt-switch> needs at least one <tmt-case min=...>")
	}
	if !hasDefault {
		return at(location, "<tmt-switch> requires a final <tmt-default>")
	}
	return nil
}
