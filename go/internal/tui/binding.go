package tui

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

const (
	MaxExpandedNodes = MaxNodes
	MaxRepeatWork    = 20_000
	MaxBoundBytes    = 8 * 1024 * 1024
	MaxIDBytes       = 256
)

// SchemaKind classifies a declared data model schema node.
type SchemaKind uint8

const (
	SchemaScalar SchemaKind = iota
	SchemaBoolean
	SchemaStableID
	SchemaObject
	SchemaCollection
)

// Schema describes the static shape of data bound to a template.
type Schema struct {
	Kind   SchemaKind
	Fields map[string]Schema
	Item   *Schema
}

func ScalarSchema() Schema                         { return Schema{Kind: SchemaScalar} }
func BooleanSchema() Schema                        { return Schema{Kind: SchemaBoolean} }
func StableIDSchema() Schema                       { return Schema{Kind: SchemaStableID} }
func ObjectSchema(fields map[string]Schema) Schema { return Schema{Kind: SchemaObject, Fields: fields} }
func CollectionSchema(item Schema) Schema          { return Schema{Kind: SchemaCollection, Item: &item} }

func (k SchemaKind) accepts(val any) bool {
	switch k {
	case SchemaScalar:
		if val == nil {
			return true
		}
		switch val.(type) {
		case string, bool, float64, float32, int, int64, int32, uint, uint64, uint32, json.Number:
			return true
		default:
			return false
		}
	case SchemaBoolean:
		_, ok := val.(bool)
		return ok
	case SchemaStableID:
		s, ok := val.(string)
		return ok && isStableID(s)
	case SchemaObject:
		_, ok := val.(map[string]any)
		return ok
	case SchemaCollection:
		_, ok := val.([]any)
		return ok
	default:
		return false
	}
}

// Sources is an application-owned source/format registry and in-memory evaluator.
type Sources[S any] interface {
	Compile(from, format string, scopes map[string]*Schema) (S, error)
	Resolve(source S, scopes map[string]any) (*string, error)
}

type bindingPath []string

func parseBindingPath(text string) (bindingPath, error) {
	parts := strings.Split(text, ".")
	if len(parts) == 0 {
		return nil, fmt.Errorf("requires a root or lexical dotted path, without indexing or expressions")
	}
	for i, p := range parts {
		if !(i == 0 && p == "$") && !isIdentifier(p) {
			return nil, fmt.Errorf("requires a root or lexical dotted path, without indexing or expressions")
		}
	}
	return bindingPath(parts), nil
}

func (p bindingPath) schema(scopes map[string]*Schema) *Schema {
	cur, ok := scopes[p[0]]
	if !ok || cur == nil {
		return nil
	}
	for _, key := range p[1:] {
		if cur.Kind != SchemaObject {
			return nil
		}
		next, ok := cur.Fields[key]
		if !ok {
			return nil
		}
		n := next
		cur = &n
	}
	return cur
}

func (p bindingPath) value(scopes map[string]any) (any, bool) {
	cur, ok := scopes[p[0]]
	if !ok {
		return nil, false
	}
	for _, key := range p[1:] {
		obj, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		cur, ok = obj[key]
		if !ok {
			return nil, false
		}
	}
	return cur, true
}

func rootSchemaPath(schema *Schema, path string) (*Schema, error) {
	p, err := parseBindingPath(path)
	if err != nil {
		return nil, err
	}
	found := p.schema(map[string]*Schema{"$": schema})
	if found == nil {
		return nil, fmt.Errorf("unknown root model path")
	}
	return found, nil
}

func isIdentifier(text string) bool {
	if text == "" {
		return false
	}
	b0 := text[0]
	if !((b0 >= 'a' && b0 <= 'z') || (b0 >= 'A' && b0 <= 'Z') || b0 == '_') {
		return false
	}
	for i := 1; i < len(text); i++ {
		b := text[i]
		if !((b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '_' || b == '-') {
			return false
		}
	}
	return true
}

func isStableID(text string) bool {
	if text == "" || len(text) > MaxIDBytes || strings.TrimSpace(text) != text {
		return false
	}
	allDigits := true
	for _, r := range text {
		if unicode.IsControl(r) {
			return false
		}
		if r < '0' || r > '9' {
			allDigits = false
		}
	}
	return !allDigits
}

type compiledPath struct {
	path  bindingPath
	shape SchemaKind
}

type compiledRepeat struct {
	path  bindingPath
	alias string
	shape SchemaKind
}

// Template is a schema-admitted compiled template ready for bounded Materialize calls.
type Template[S any] struct {
	element   MarkupElement
	paths     map[string]compiledPath
	rootShape SchemaKind
	repeat    *compiledRepeat
	source    S
	hasSource bool
	children  []Template[S]
}

func kindTagName(k Kind) string {
	switch k {
	case KindView:
		return "tmt-view"
	case KindRow:
		return "tmt-row"
	case KindCol:
		return "tmt-col"
	case KindCell:
		return "tmt-cell"
	case KindText:
		return "tmt-text"
	case KindRepeat:
		return "tmt-repeat"
	case KindModal:
		return "tmt-modal"
	case KindScroll:
		return "tmt-scroll"
	case KindKeyHelp:
		return "tmt-key-help"
	case KindList:
		return "tmt-list"
	case KindTable:
		return "tmt-table"
	case KindPicker:
		return "tmt-picker"
	case KindSwitch:
		return "tmt-switch"
	case KindCase:
		return "tmt-case"
	case KindDefault:
		return "tmt-default"
	default:
		return "tmt-unknown"
	}
}

func bindingFail(file string, element *MarkupElement, msg string) error {
	return &MarkupError{
		File:     file,
		Location: element.Location,
		Message:  fmt.Sprintf("<%s>: %s", kindTagName(element.Kind), msg),
	}
}

// CompileTemplate compiles a structurally admitted MarkupElement against schema and sources.
func CompileTemplate[S any](file string, element *MarkupElement, schema *Schema, sources Sources[S]) (*Template[S], error) {
	if element.Kind != KindView {
		return nil, bindingFail(file, element, "binding root must be tmt-view")
	}
	tpl, err := checkTemplate(file, element, map[string]*Schema{"$": schema}, sources)
	if err != nil {
		return nil, err
	}
	return &tpl, nil
}

func checkTemplate[S any](file string, element *MarkupElement, scopes map[string]*Schema, sources Sources[S]) (Template[S], error) {
	attrs := element.Attributes
	fail := func(msg string) (Template[S], error) {
		return Template[S]{}, bindingFail(file, element, msg)
	}
	switch element.Kind {
	case KindModal, KindScroll, KindKeyHelp, KindList, KindTable, KindPicker:
		return fail("component markup must be lowered by components::surface::compile")
	}
	if _, hasSlot := attrs["slot"]; hasSlot {
		return fail("component markup must be lowered by components::surface::compile")
	}

	parseAttrPath := func(key string) (bindingPath, error) {
		p, err := parseBindingPath(attrs[key])
		if err != nil {
			return nil, bindingFail(file, element, fmt.Sprintf("%s=%q: %s", key, attrs[key], err.Error()))
		}
		return p, nil
	}

	inner := make(map[string]*Schema, len(scopes)+1)
	for k, v := range scopes {
		inner[k] = v
	}

	var repeat *compiledRepeat
	if element.Kind == KindRepeat {
		each, err := parseAttrPath("each")
		if err != nil {
			return Template[S]{}, err
		}
		sc := each.schema(scopes)
		if sc == nil || sc.Kind != SchemaCollection || sc.Item == nil {
			return fail(fmt.Sprintf("each=%q: expected a declared collection", attrs["each"]))
		}
		alias := attrs["as"]
		if !isIdentifier(alias) {
			return fail(fmt.Sprintf("as=%q: invalid lexical name", alias))
		}
		inner[alias] = sc.Item
		repeat = &compiledRepeat{path: each, alias: alias, shape: sc.Item.Kind}
	}

	paths := make(map[string]compiledPath)
	for _, key := range []string{"bind", "id-bind", "row-bind", "token-bind"} {
		if _, ok := attrs[key]; !ok {
			continue
		}
		compiled, err := parseAttrPath(key)
		if err != nil {
			return Template[S]{}, err
		}
		sc := compiled.schema(scopes)
		valid := false
		if sc != nil {
			switch key {
			case "id-bind", "row-bind":
				valid = sc.Kind == SchemaStableID
			case "bind":
				valid = sc.Kind == SchemaScalar || sc.Kind == SchemaBoolean || sc.Kind == SchemaStableID
			case "token-bind":
				valid = sc.Kind == SchemaScalar || sc.Kind == SchemaStableID
			}
		}
		if !valid {
			return fail(fmt.Sprintf("%s=%q: unknown path or incompatible schema (IDs require StableId)", key, attrs[key]))
		}
		paths[key] = compiledPath{path: compiled, shape: sc.Kind}
	}

	for _, key := range []string{"id", "row-id"} {
		if val, ok := attrs[key]; ok && !isStableID(val) {
			return fail(fmt.Sprintf("%s=%q: requires a nonempty stable ID of at most %d bytes", key, val, MaxIDBytes))
		}
	}
	_, hasRowID := attrs["row-id"]
	_, hasRowBind := attrs["row-bind"]
	_, hasID := attrs["id"]
	_, hasIDBind := attrs["id-bind"]
	if (hasRowID || hasRowBind) && !(hasID || hasIDBind) {
		return fail("actionable row requires id or id-bind")
	}
	_, hasTok := attrs["token"]
	_, hasTokBind := attrs["token-bind"]
	if hasTok && hasTokBind {
		return fail("use either token or token-bind")
	}
	if sel, ok := attrs["selected"]; ok && sel != "true" && sel != "false" {
		return fail(fmt.Sprintf("selected=%q: expected true or false", sel))
	}

	var src S
	hasSource := false
	if from, ok := attrs["from"]; ok {
		formatVal, hasFmt := attrs["format"]
		fmtArg := "text"
		if hasFmt {
			fmtArg = formatVal
		}
		compiled, err := sources.Compile(from, fmtArg, scopes)
		if err != nil {
			return fail(fmt.Sprintf("from=%q format=%v: %s", from, formatVal, err.Error()))
		}
		src = compiled
		hasSource = true
	} else if _, hasFmt := attrs["format"]; hasFmt {
		return fail("format requires from; bound fields are already display values")
	}

	children := make([]Template[S], len(element.Children))
	for i := range element.Children {
		ch, err := checkTemplate(file, &element.Children[i], inner, sources)
		if err != nil {
			return Template[S]{}, err
		}
		children[i] = ch
	}

	attrsCopy := make(map[string]string, len(attrs))
	for k, v := range attrs {
		attrsCopy[k] = v
	}
	admitted := MarkupElement{
		Kind:       element.Kind,
		Style:      element.Style,
		Attributes: attrsCopy,
		Text:       element.Text,
		Location:   element.Location,
	}
	return Template[S]{
		element:   admitted,
		paths:     paths,
		rootShape: scopes["$"].Kind,
		repeat:    repeat,
		source:    src,
		hasSource: hasSource,
		children:  children,
	}, nil
}

type expandBudget struct {
	nodes   int
	repeats int
	bytes   int
	ids     map[string]struct{}
}

func (b *expandBudget) charge(n int) error {
	if n < 0 || b.bytes > MaxBoundBytes-n {
		return fmt.Errorf("bound text/IDs exceed 8 MiB")
	}
	b.bytes += n
	return nil
}

func idKey(parts []string) string {
	// Length-prefixed encoding avoids delimiter collisions between components.
	var b strings.Builder
	for _, p := range parts {
		b.WriteString(strconv.Itoa(len(p)))
		b.WriteByte(':')
		b.WriteString(p)
		b.WriteByte(';')
	}
	return b.String()
}

func cloneIDSet(m map[string]struct{}) map[string]struct{} {
	out := make(map[string]struct{}, len(m))
	for k := range m {
		out[k] = struct{}{}
	}
	return out
}

// Materialize expands a compiled template against in-memory JSON-like data.
func (t *Template[S]) Materialize(file string, data any, sources Sources[S]) (*SceneNode, error) {
	if !t.rootShape.accepts(data) {
		return nil, bindingFail(file, &t.element, "root data does not match schema")
	}
	budget := &expandBudget{ids: make(map[string]struct{})}
	nodes, err := t.expand(file, map[string]any{"$": data}, sources, nil, budget)
	if err != nil {
		return nil, err
	}
	return &nodes[0], nil
}

func formatScalarNumber(val any) (string, bool) {
	switch v := val.(type) {
	case json.Number:
		return v.String(), true
	case int:
		return strconv.Itoa(v), true
	case int64:
		return strconv.FormatInt(v, 10), true
	case int32:
		return strconv.FormatInt(int64(v), 10), true
	case uint:
		return strconv.FormatUint(uint64(v), 10), true
	case uint64:
		return strconv.FormatUint(v, 10), true
	case uint32:
		return strconv.FormatUint(uint64(v), 10), true
	case float64:
		if math.Trunc(v) == v && !math.IsInf(v, 0) && !math.IsNaN(v) {
			return strconv.FormatInt(int64(v), 10), true
		}
		return strconv.FormatFloat(v, 'f', -1, 64), true
	case float32:
		return strconv.FormatFloat(float64(v), 'f', -1, 32), true
	default:
		return "", false
	}
}

func (t *Template[S]) expand(
	file string,
	scopes map[string]any,
	sources Sources[S],
	parent []string,
	budget *expandBudget,
) ([]SceneNode, error) {
	fail := func(msg string) ([]SceneNode, error) {
		return nil, bindingFail(file, &t.element, msg)
	}

	if t.repeat != nil {
		raw, ok := t.repeat.path.value(scopes)
		items, isArr := raw.([]any)
		if !ok || !isArr {
			return fail(fmt.Sprintf("each=%q: missing or non-collection value", t.element.Attributes["each"]))
		}
		var result []SceneNode
		for _, item := range items {
			budget.repeats++
			if budget.repeats > MaxRepeatWork {
				return fail("repeat work exceeds 20,000")
			}
			if !t.repeat.shape.accepts(item) {
				return fail(fmt.Sprintf("each=%q: item does not match schema", t.element.Attributes["each"]))
			}
			inner := make(map[string]any, len(scopes)+1)
			for k, v := range scopes {
				inner[k] = v
			}
			inner[t.repeat.alias] = item
			for i := range t.children {
				expanded, err := t.children[i].expand(file, inner, sources, parent, budget)
				if err != nil {
					return nil, err
				}
				result = append(result, expanded...)
			}
		}
		return result, nil
	}

	budget.nodes++
	if budget.nodes > MaxExpandedNodes {
		return fail("expanded nodes exceed 20,000")
	}

	resolveBound := func(key string) (*string, error) {
		cp := t.paths[key]
		val, ok := cp.path.value(scopes)
		if !ok {
			return nil, bindingFail(file, &t.element, fmt.Sprintf("%s=%q: missing path", key, t.element.Attributes[key]))
		}
		if !cp.shape.accepts(val) {
			return nil, bindingFail(file, &t.element, fmt.Sprintf("%s=%q: value does not match schema", key, t.element.Attributes[key]))
		}
		if val == nil {
			return nil, nil
		}
		if s, ok := val.(string); ok {
			return &s, nil
		}
		if key == "bind" {
			if b, ok := val.(bool); ok {
				s := "false"
				if b {
					s = "true"
				}
				return &s, nil
			}
			if s, ok := formatScalarNumber(val); ok {
				return &s, nil
			}
		}
		return nil, bindingFail(file, &t.element, fmt.Sprintf("%s=%q: incompatible scalar value", key, t.element.Attributes[key]))
	}

	resolveID := func(literal, binding string) (*string, error) {
		_, hasBind := t.paths[binding]
		litVal, hasLit := t.element.Attributes[literal]
		var val *string
		if hasBind {
			var err error
			val, err = resolveBound(binding)
			if err != nil {
				return nil, err
			}
		} else if hasLit {
			s := litVal
			val = &s
		}
		if (hasBind || hasLit) && (val == nil || !isStableID(*val)) {
			return nil, bindingFail(file, &t.element, fmt.Sprintf("%s/%s: null or unstable ID", binding, literal))
		}
		return val, nil
	}

	own, err := resolveID("id", "id-bind")
	if err != nil {
		return nil, err
	}
	scope := make([]string, len(parent), len(parent)+1)
	copy(scope, parent)
	var resolvedID []string
	if own != nil {
		parentBytes := 0
		for _, p := range parent {
			parentBytes += len(p)
		}
		if err := budget.charge(2 * (parentBytes + len(*own))); err != nil {
			return fail(err.Error())
		}
		scope = append(scope, *own)
		resolvedID = make([]string, len(scope))
		copy(resolvedID, scope)
		key := idKey(resolvedID)
		if _, dup := budget.ids[key]; dup {
			return fail(fmt.Sprintf("duplicate resolved id %q", resolvedID))
		}
		budget.ids[key] = struct{}{}
	}

	rowID, err := resolveID("row-id", "row-bind")
	if err != nil {
		return nil, err
	}

	var text *string
	if _, hasBind := t.paths["bind"]; hasBind {
		text, err = resolveBound("bind")
		if err != nil {
			return nil, err
		}
	} else if t.hasSource {
		text, err = sources.Resolve(t.source, scopes)
		if err != nil {
			return fail(fmt.Sprintf("from=%q: %s", t.element.Attributes["from"], err.Error()))
		}
	} else {
		s := t.element.Text
		text = &s
	}

	chargeBytes := 0
	if text != nil {
		chargeBytes += len(*text)
	}
	if rowID != nil {
		chargeBytes += len(*rowID)
	}
	if err := budget.charge(chargeBytes); err != nil {
		return fail(err.Error())
	}

	style := t.element.Style
	if _, hasTokBind := t.paths["token-bind"]; hasTokBind {
		tokStr, err := resolveBound("token-bind")
		if err != nil {
			return nil, err
		}
		if tokStr == nil {
			style.Token = nil
		} else {
			role, ok := clistyle.ParseRole(*tokStr)
			if !ok {
				return fail(fmt.Sprintf("token-bind=%q: unknown token", t.element.Attributes["token-bind"]))
			}
			style.Token = &role
		}
	}

	var children []SceneNode
	if t.element.Kind == KindSwitch {
		outside := cloneIDSet(budget.ids)
		seen := cloneIDSet(outside)
		for i := range t.children {
			budget.ids = cloneIDSet(outside)
			expanded, err := t.children[i].expand(file, scopes, sources, scope, budget)
			if err != nil {
				return nil, err
			}
			children = append(children, expanded...)
			for k := range budget.ids {
				seen[k] = struct{}{}
			}
		}
		budget.ids = seen
	} else {
		for i := range t.children {
			expanded, err := t.children[i].expand(file, scopes, sources, scope, budget)
			if err != nil {
				return nil, err
			}
			children = append(children, expanded...)
		}
	}

	var cond Cond
	switch t.element.Kind {
	case KindSwitch:
		of := SwitchOfContainer
		if t.element.Attributes["of"] == "terminal" {
			of = SwitchOfTerminal
		}
		cond = Cond{Kind: CondSwitch, Of: of}
	case KindCase:
		bp, _ := parseBreakpoint(t.element.Attributes["min"])
		cond = Cond{Kind: CondCase, Min: bp.cells}
	}

	return []SceneNode{{
		Kind:     t.element.Kind,
		Cond:     cond,
		Style:    style,
		ID:       resolvedID,
		RowID:    rowID,
		Selected: t.element.Attributes["selected"] == "true",
		Text:     text,
		Token:    style.Token,
		Children: children,
	}}, nil
}
