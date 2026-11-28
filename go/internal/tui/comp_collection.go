package tui

import (
	"errors"
	"fmt"
	"math"
	"slices"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

const componentDisabledID = "component-disabled"

type listSpec struct {
	id    []string
	empty string
}

func collectionFail(file string, element *MarkupElement, msg string) error {
	return &MarkupError{File: file, Location: element.Location, Message: msg}
}

func cloneMarkupElement(el MarkupElement) MarkupElement {
	out := el
	out.Attributes = make(map[string]string, len(el.Attributes))
	for k, v := range el.Attributes {
		out.Attributes[k] = v
	}
	if len(el.Children) > 0 {
		out.Children = make([]MarkupElement, len(el.Children))
		for i, c := range el.Children {
			out.Children[i] = cloneMarkupElement(c)
		}
	}
	return out
}

func cloneSceneNode(n SceneNode) SceneNode {
	out := n
	if len(n.ID) > 0 {
		out.ID = append([]string(nil), n.ID...)
	}
	if n.RowID != nil {
		s := *n.RowID
		out.RowID = &s
	}
	if n.Text != nil {
		s := *n.Text
		out.Text = &s
	}
	if n.Token != nil {
		r := *n.Token
		out.Token = &r
	}
	if n.Style.Token != nil {
		r := *n.Style.Token
		out.Style.Token = &r
	}
	if len(n.Children) > 0 {
		out.Children = make([]SceneNode, len(n.Children))
		for i, c := range n.Children {
			out.Children[i] = cloneSceneNode(c)
		}
	}
	return out
}

func lowerCollection(file string, element *MarkupElement, id []string, schema *Schema) (listSpec, error) {
	path, ok := element.Attributes["bind"]
	if !ok {
		return listSpec{}, collectionFail(file, element, "list/table requires bind")
	}
	delete(element.Attributes, "bind")
	sc, err := rootSchemaPath(schema, path)
	if err != nil {
		return listSpec{}, collectionFail(file, element, err.Error())
	}
	if sc.Kind != SchemaCollection || sc.Item == nil {
		return listSpec{}, collectionFail(file, element, "list/table bind requires a collection")
	}
	if sc.Item.Kind != SchemaObject {
		return listSpec{}, collectionFail(file, element, "list/table rows must be objects")
	}
	idField, hasID := sc.Item.Fields["id"]
	disField, hasDis := sc.Item.Fields["disabled"]
	if !hasID || idField.Kind != SchemaStableID || !hasDis || disField.Kind != SchemaBoolean {
		return listSpec{}, collectionFail(file, element, "rows require id: StableId and disabled: Boolean")
	}
	alias := "row"
	if v, ok := element.Attributes["as"]; ok {
		alias = v
		delete(element.Attributes, "as")
	}
	empty := "(no items)"
	if v, ok := element.Attributes["empty"]; ok {
		empty = v
		delete(element.Attributes, "empty")
	}
	if element.Style.Display == DisplayGrid {
		return listSpec{}, collectionFail(file, element, "grid tracks belong to the table row, not its container")
	}
	if len(element.Children) != 1 || element.Children[0].Kind != KindRow {
		return listSpec{}, collectionFail(file, element, "list/table requires exactly one tmt-row template")
	}
	row := element.Children[0]
	element.Children = nil
	if element.Kind == KindTable && (row.Style.Display != DisplayGrid || len(row.Style.Columns) == 0) {
		return listSpec{}, collectionFail(file, &row, "table row requires explicit grid tracks")
	}
	for _, key := range []string{"id", "id-bind", "row-id", "row-bind", "selected"} {
		if _, exists := row.Attributes[key]; exists {
			return listSpec{}, collectionFail(file, &row, "list/table owns row identity and selection")
		}
	}
	var checkReserved func(el *MarkupElement) error
	checkReserved = func(el *MarkupElement) error {
		for _, key := range []string{"selected", "row-id", "row-bind"} {
			if _, exists := el.Attributes[key]; exists {
				return collectionFail(file, el, "list/table owns row identity and selection")
			}
		}
		if el.Attributes["id"] == componentDisabledID {
			return collectionFail(file, el, "component-disabled is a reserved row field")
		}
		switch el.Kind {
		case KindModal, KindScroll, KindKeyHelp, KindList, KindTable, KindPicker:
			return collectionFail(file, el, "row templates may contain primitives only")
		}
		for i := range el.Children {
			if err := checkReserved(&el.Children[i]); err != nil {
				return err
			}
		}
		return nil
	}
	if err := checkReserved(&row); err != nil {
		return listSpec{}, err
	}

	row.Attributes["id-bind"] = alias + ".id"
	row.Attributes["row-bind"] = alias + ".id"
	row.Style.Width = FullExtent()

	disParsed, err := Parse(file, fmt.Sprintf(`<tmt-view version="1"><tmt-text id="%s" bind="$.disabled"/></tmt-view>`, componentDisabledID))
	if err != nil {
		return listSpec{}, err
	}
	disabled := disParsed.Children[0]
	disabled.Location = row.Location
	disabled.Attributes["bind"] = alias + ".disabled"
	row.Children = append([]MarkupElement{disabled}, row.Children...)

	repParsed, err := Parse(file, `<tmt-view version="1"><tmt-repeat each="$.rows" as="row"/></tmt-view>`)
	if err != nil {
		return listSpec{}, err
	}
	repeat := repParsed.Children[0]
	repeat.Location = element.Location
	repeat.Attributes["each"] = path
	repeat.Attributes["as"] = alias
	repeat.Children = append(repeat.Children, row)

	element.Children = append(element.Children, repeat)
	element.Kind = KindCol
	element.Style.Direction = DirectionColumn
	return listSpec{
		id:    append([]string(nil), id...),
		empty: empty,
	}, nil
}

func findSceneNodeMut(node *SceneNode, id []string) *SceneNode {
	if slices.Equal(node.ID, id) {
		return node
	}
	for i := range node.Children {
		if found := findSceneNodeMut(&node.Children[i], id); found != nil {
			return found
		}
	}
	return nil
}

func extractListRows(file string, node *SceneNode, spec *listSpec, loc Location) ([]ListRow, error) {
	fail := func(msg string) ([]ListRow, error) {
		return nil, &MarkupError{File: file, Location: loc, Message: msg}
	}
	list := findSceneNodeMut(node, spec.id)
	if list == nil {
		return fail("missing materialized list")
	}
	rows := make([]ListRow, 0, len(list.Children))
	for i := range list.Children {
		row := &list.Children[i]
		marker := row.Children[0]
		row.Children = row.Children[1:]
		var disabled bool
		if marker.Text != nil && *marker.Text == "true" {
			disabled = true
		} else if marker.Text != nil && *marker.Text == "false" {
			disabled = false
		} else {
			return fail("row.disabled must be a boolean")
		}
		if row.RowID == nil {
			return fail("missing stable row ID")
		}
		rows = append(rows, ListRow{ID: *row.RowID, Disabled: disabled})
		if disabled {
			var mute func(n *SceneNode)
			mute = func(n *SceneNode) {
				keep := n.Style.Token != nil && (*n.Style.Token == clistyle.RoleBlocked || *n.Style.Token == clistyle.RoleWaiting || *n.Style.Token == clistyle.RoleWorking)
				if !keep {
					r := clistyle.RoleMuted
					n.Style.Token = &r
					n.Token = &r
				}
				for j := range n.Children {
					mute(&n.Children[j])
				}
			}
			mute(row)
		}
	}
	if len(rows) == 0 {
		s := spec.empty
		list.Text = &s
		r := clistyle.RoleMuted
		list.Style.Token = &r
		list.Token = &r
	}
	return rows, nil
}

func selectListRow(node *SceneNode, spec *listSpec, selected *string) {
	list := findSceneNodeMut(node, spec.id)
	if list == nil {
		return
	}
	for i := range list.Children {
		row := &list.Children[i]
		row.Selected = selected != nil && row.RowID != nil && *row.RowID == *selected
	}
}

func publishListFrame(cells []LayoutCell, listID []string, scroll *ScrollState, rows []ListRow, selected *string, area Rect, content int) ListFrame {
	var geometry []RowGeometry
	var clips []LayoutRect
	for _, cell := range cells {
		if len(cell.Node.ID) != len(listID)+1 || !slices.Equal(cell.Node.ID[:len(listID)], listID) {
			continue
		}
		if cell.Node.RowID == nil {
			continue
		}
		start := int(max(cell.Rect.Y, 0))
		clips = append(clips, cell.Rect.Intersect(cell.Clip))
		geometry = append(geometry, RowGeometry{
			ID:      *cell.Node.RowID,
			Lines:   LineRange{Start: start, End: start + int(cell.Rect.Height)},
			Visible: NewRect(area.X, area.Y, 0, 0),
		})
	}
	var selRange *LineRange
	if selected != nil {
		for _, g := range geometry {
			if g.ID == *selected {
				r := g.Lines
				selRange = &r
				break
			}
		}
	}
	scroll.Update(area, content, selRange)
	off := scroll.Offset()
	for i := range geometry {
		vp := LayoutRect{
			X:      0,
			Y:      int32(min(off, math.MaxInt32)),
			Width:  uint32(area.Width),
			Height: uint32(area.Height),
		}
		vis := clips[i].Intersect(vp)
		if vis.Width > 0 && vis.Height > 0 {
			vx := uint16(min(uint32(area.X)+uint32(max(vis.X, 0)), 0xffff))
			vy := uint16(min(uint32(area.Y)+uint32(int(vis.Y)-off), 0xffff))
			geometry[i].Visible = NewRect(vx, vy, uint16(vis.Width), uint16(vis.Height)).Intersect(area)
		}
	}
	return ListFrame{
		Rows:     append([]ListRow(nil), rows...),
		Geometry: geometry,
		Viewport: area,
		Offset:   off,
	}
}

func translateCells(cells []LayoutCell, area Rect, offset int) {
	clip := LayoutRect{
		X:      int32(area.X),
		Y:      int32(area.Y),
		Width:  uint32(area.Width),
		Height: uint32(area.Height),
	}
	off32 := int32(min(offset, math.MaxInt32))
	for i := range cells {
		for _, r := range []*LayoutRect{&cells[i].Rect, &cells[i].Content, &cells[i].Clip} {
			r.X += int32(area.X)
			r.Y = r.Y + int32(area.Y) - off32
		}
		cells[i].Clip = cells[i].Clip.Intersect(clip)
	}
}

func prepareCollectionNode(node *SceneNode) {
	node.Style.Shrink = 0
	node.Style.Grow = 0
	for i := range node.Children {
		prepareCollectionNode(&node.Children[i])
	}
}

func measureCellsHeight(cells []LayoutCell) (int, error) {
	var maxBottom int64
	for i := 1; i < len(cells); i++ {
		b := int64(cells[i].Rect.Y) + int64(cells[i].Rect.Height)
		if b > maxBottom {
			maxBottom = b
		}
	}
	if maxBottom > math.MaxUint16 {
		return 0, errors.New("list content exceeds 65535 visual lines")
	}
	return int(maxBottom), nil
}

// Table is a compiled list or table pane surface without modal chrome.
type Table[S any] struct {
	binding  *Template[S]
	spec     listSpec
	location Location
}

// ListSurface is a materialized list or table ready for RenderCollection.
type ListSurface struct {
	node SceneNode
	rows []ListRow
	spec listSpec
}

// CompileCollection compiles one tmt-list or tmt-table inside tmt-view.
func CompileCollection[S any](file string, parsed *MarkupElement, schema *Schema, sources Sources[S]) (*Table[S], error) {
	if parsed.Kind != KindView || len(parsed.Children) != 1 ||
		(parsed.Children[0].Kind != KindList && parsed.Children[0].Kind != KindTable) {
		return nil, collectionFail(file, parsed, "collection surface requires one list or table")
	}
	if _, hasBind := parsed.Attributes["id-bind"]; hasBind {
		return nil, collectionFail(file, parsed, "collection root requires literal identity")
	}
	lowered := cloneMarkupElement(*parsed)
	elem := &lowered.Children[0]
	_, hasIDBind := elem.Attributes["id-bind"]
	idVal, hasID := elem.Attributes["id"]
	if hasIDBind || !hasID {
		return nil, collectionFail(file, elem, "list/table requires a literal stable ID")
	}
	var ids []string
	if rootID, ok := parsed.Attributes["id"]; ok {
		ids = append(ids, rootID)
	}
	ids = append(ids, idVal)
	loc := elem.Location
	spec, err := lowerCollection(file, elem, ids, schema)
	if err != nil {
		return nil, err
	}
	nodes := uint32(0)
	if err := checkSurfaceBounds(file, &lowered, 0, &nodes); err != nil {
		return nil, err
	}
	tpl, err := CompileTemplate(file, &lowered, schema, sources)
	if err != nil {
		return nil, err
	}
	return &Table[S]{binding: tpl, spec: spec, location: loc}, nil
}

func (t *Table[S]) Materialize(file string, data any, sources Sources[S]) (*ListSurface, error) {
	node, err := t.binding.Materialize(file, data, sources)
	if err != nil {
		return nil, err
	}
	rows, err := extractListRows(file, node, &t.spec, t.location)
	if err != nil {
		return nil, err
	}
	return &ListSurface{node: *node, rows: rows, spec: t.spec}, nil
}

// RenderCollection reconciles state, lays out and paints a ListSurface into buffer.
func RenderCollection(
	surface *ListSurface,
	state *ListState,
	area Rect,
	buffer *Buffer,
	style RenderStyle,
	selection func(clistyle.Role) Style,
) (ListFrame, error) {
	if err := state.Reconcile(append([]ListRow(nil), surface.rows...)); err != nil {
		return ListFrame{}, err
	}
	node := cloneSceneNode(surface.node)
	var selPtr *string
	if sel, ok := state.Selected(); ok {
		selPtr = &sel
	}
	selectListRow(&node, &surface.spec, selPtr)
	prepareCollectionNode(&node)
	node.Style.Height = CellsExtent(math.MaxUint16)
	area = area.Intersect(buffer.Area)
	cells, err := Layout(&node, [2]uint16{area.Width, math.MaxUint16}, MeasureText)
	if err != nil {
		return ListFrame{}, err
	}
	h, err := measureCellsHeight(cells)
	if err != nil {
		return ListFrame{}, err
	}
	vp := area
	if h > int(area.Height) && vp.Height > 0 {
		vp.Height--
	}
	frame := publishListFrame(cells, surface.spec.id, &state.Scroll, state.Rows(), selPtr, vp, h)
	translateCells(cells, vp, state.Scroll.Offset())
	Paint(cells, buffer, style.Theme, style.Depth, selection)

	below := max(h-(state.Scroll.Offset()+int(vp.Height)), 0)
	if vp.Height < area.Height {
		ind := NewRect(area.X, vp.Bottom(), area.Width, 1)
		dim := ScreenStyle(style.Theme, clistyle.RoleDim, style.Depth)
		for x := ind.X; x < ind.Right(); x++ {
			c := buffer.At(x, ind.Y)
			c.Reset()
			c.SetStyle(dim)
		}
		label := ""
		if below > 0 {
			label = fmt.Sprintf("%d more ↓", below)
		}
		fitted := FitLine(label, ind.Width, TruncateFlow(), clistyle.AlignLeft)
		buffer.SetString(ind.X, ind.Y, fitted, dim)
	}
	return frame, nil
}
