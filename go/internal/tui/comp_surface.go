package tui

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"sort"
	"strings"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

const helpRowsTemplate = `<tmt-view version="1"><tmt-repeat each="$.help.sections" as="section"><tmt-col id-bind="section.id" class="shrink-0"><tmt-text bind="section.title" token="muted" wrap="true"/><tmt-repeat each="section.entries" as="entry"><tmt-row id-bind="entry.id" row-bind="entry.id" class="shrink-0 gap-2"><tmt-text id="keys" bind="entry.keys" token="accent" wrap="true"/><tmt-text id="description" bind="entry.description" token="text" wrap="true"/></tmt-row></tmt-repeat></tmt-col></tmt-repeat></tmt-view>`

type modalSlot uint8

const (
	modalSlotFooter modalSlot = iota
	modalSlotStatus
	modalSlotQuery
)

type surfaceSpec struct {
	modal   Modal
	helpIDs [][]string
	slots   []modalSlot
	list    *listSpec
}

func (s *surfaceSpec) has(slot modalSlot) bool {
	return slices.Contains(s.slots, slot)
}

// SurfaceTemplate is a compiled modal or picker surface.
type SurfaceTemplate[S any] struct {
	binding  *Template[S]
	position *Template[S]
	spec     surfaceSpec
}

// ModalSurface is a materialized modal or picker ready for RenderSurface / RenderSurfaceList.
type ModalSurface struct {
	node     SceneNode
	position SceneNode
	spec     surfaceSpec
	rows     []ListRow
}

// SurfaceHit is a painted hit rectangle in buffer coordinates.
type SurfaceHit struct {
	Rect  Rect
	ID    []string
	RowID *string
}

// FrameMap holds the layout areas, hits, optional ListFrame, and query Rect for a rendered modal surface.
type FrameMap struct {
	Areas ModalAreas
	Hits  []SurfaceHit
	List  *ListFrame
	Query Rect
}

// RenderStyle bundles Theme and Depth for surface and collection rendering.
type RenderStyle struct {
	Theme clistyle.Theme
	Depth clistyle.Depth
}

// HitAt returns the topmost SurfaceHit containing (x, y), or nil.
func (f *FrameMap) HitAt(x, y uint16) *SurfaceHit {
	pt := Position{X: x, Y: y}
	for i := len(f.Hits) - 1; i >= 0; i-- {
		if f.Hits[i].Rect.Contains(pt) {
			return &f.Hits[i]
		}
	}
	return nil
}

func checkSurfaceBounds(file string, element *MarkupElement, depth int, nodes *uint32) error {
	*nodes++
	if depth >= MaxDepth || *nodes > MaxNodes {
		return collectionFail(file, element, "lowered component template exceeds markup depth/node limits")
	}
	for i := range element.Children {
		if err := checkSurfaceBounds(file, &element.Children[i], depth+1, nodes); err != nil {
			return err
		}
	}
	return nil
}

// CompileSurface admits and lowers a tmt-modal or tmt-picker inside tmt-view.
func CompileSurface[S any](file string, parsed *MarkupElement, schema *Schema, sources Sources[S]) (*SurfaceTemplate[S], error) {
	if parsed.Kind != KindView || len(parsed.Children) != 1 ||
		(parsed.Children[0].Kind != KindModal && parsed.Children[0].Kind != KindPicker) {
		return nil, collectionFail(file, parsed, "component surface requires one tmt-modal or tmt-picker inside tmt-view")
	}
	lowered := cloneMarkupElement(*parsed)
	elem := &lowered.Children[0]
	if elem.Kind == KindPicker {
		choicesIdx := -1
		hasQuery := false
		for i := range elem.Children {
			ch := &elem.Children[i]
			switch {
			case ch.Kind == KindList || ch.Kind == KindTable:
				if choicesIdx >= 0 {
					return nil, collectionFail(file, ch, "picker requires exactly one list/table")
				}
				choicesIdx = i
			case ch.Kind == KindText && ch.Attributes["slot"] == "query":
				hasQuery = true
			case ch.Kind != KindText:
				return nil, collectionFail(file, ch, "picker children must be list/table and query/footer/status text")
			}
		}
		if choicesIdx < 0 {
			return nil, collectionFail(file, elem, "picker requires one list/table")
		}
		if !hasQuery {
			return nil, collectionFail(file, elem, "picker requires a query slot (may be empty for selection-only)")
		}
		choice := elem.Children[choicesIdx]
		elem.Children = append(elem.Children[:choicesIdx], elem.Children[choicesIdx+1:]...)
		bodyParsed, err := Parse(file, `<tmt-view version="1"><tmt-scroll id="picker-body"/></tmt-view>`)
		if err != nil {
			return nil, err
		}
		body := bodyParsed.Children[0]
		body.Location = elem.Location
		body.Children = append(body.Children, choice)
		elem.Children = append([]MarkupElement{body}, elem.Children...)
		elem.Kind = KindModal
	}

	title := strings.TrimSpace(elem.Attributes["title"])
	rawTitle := elem.Attributes["title"]
	delete(elem.Attributes, "title")
	if title == "" {
		return nil, collectionFail(file, elem, "tmt-modal requires a nonempty title")
	}
	placementStr := "center"
	if v, ok := elem.Attributes["placement"]; ok {
		placementStr = v
		delete(elem.Attributes, "placement")
	}
	var placement Placement
	switch placementStr {
	case "body":
		placement = PlacementBody
	case "center":
		placement = PlacementCenter
	case "docked":
		placement = PlacementDocked
	default:
		return nil, collectionFail(file, elem, "placement must be body, center or docked")
	}

	spec := surfaceSpec{modal: Modal{Title: rawTitle, Placement: placement}}
	scrolls := 0
	for i := range elem.Children {
		ch := &elem.Children[i]
		switch ch.Kind {
		case KindScroll:
			scrolls++
		case KindText:
			slot, ok := ch.Attributes["slot"]
			if !ok {
				return nil, collectionFail(file, ch, "modal text requires a footer or status slot")
			}
			delete(ch.Attributes, "slot")
			var sk modalSlot
			switch slot {
			case "footer":
				sk = modalSlotFooter
			case "status":
				sk = modalSlotStatus
			case "query":
				sk = modalSlotQuery
			default:
				return nil, collectionFail(file, ch, "slot must be query, footer or status")
			}
			if spec.has(sk) {
				return nil, collectionFail(file, ch, fmt.Sprintf("duplicate %s slot", slot))
			}
			spec.slots = append(spec.slots, sk)
		default:
			return nil, collectionFail(file, ch, "modal children must be one tmt-scroll and footer/status text")
		}
	}
	if scrolls != 1 {
		return nil, collectionFail(file, elem, "modal requires exactly one tmt-scroll")
	}
	sort.SliceStable(elem.Children, func(i, j int) bool {
		return elem.Children[i].Kind == KindScroll && elem.Children[j].Kind != KindScroll
	})

	var ids []string
	var counts [2]int
	if err := lowerSurface(file, &lowered, &ids, false, &spec, &counts, schema); err != nil {
		return nil, err
	}
	nodes := uint32(0)
	if err := checkSurfaceBounds(file, &lowered, 0, &nodes); err != nil {
		return nil, err
	}
	posParsed, err := Parse(file, `<tmt-view version="1"><tmt-text token="muted" class="truncate"/></tmt-view>`)
	if err != nil {
		return nil, err
	}
	tpl, err := CompileTemplate(file, &lowered, schema, sources)
	if err != nil {
		return nil, err
	}
	emptySchema := ObjectSchema(map[string]Schema{})
	posTpl, err := CompileTemplate(file, posParsed, &emptySchema, sources)
	if err != nil {
		return nil, err
	}
	return &SurfaceTemplate[S]{binding: tpl, position: posTpl, spec: spec}, nil
}

func lowerSurface(file string, element *MarkupElement, ids *[]string, dynamic bool, spec *surfaceSpec, counts *[2]int, schema *Schema) error {
	_, hasIDBind := element.Attributes["id-bind"]
	dynamic = dynamic || element.Kind == KindRepeat || hasIDBind
	isComp := element.Kind == KindModal || element.Kind == KindScroll || element.Kind == KindKeyHelp || element.Kind == KindList || element.Kind == KindTable
	if isComp {
		if _, hasID := element.Attributes["id"]; dynamic || !hasID {
			return collectionFail(file, element, "components require literal stable IDs outside repeat/dynamic ID scopes")
		}
	}
	prevLen := len(*ids)
	if id, ok := element.Attributes["id"]; ok {
		*ids = append(*ids, id)
	}
	switch element.Kind {
	case KindModal, KindScroll:
		idx := 0
		if element.Kind == KindScroll {
			idx = 1
		}
		counts[idx]++
		if counts[idx] > 1 {
			return collectionFail(file, element, "nested modal/scroll components are not supported")
		}
		element.Kind = KindCol
		element.Style.Direction = DirectionColumn
	case KindList, KindTable:
		if spec.list != nil {
			return collectionFail(file, element, "one scroll surface supports one list/table")
		}
		ls, err := lowerCollection(file, element, *ids, schema)
		if err != nil {
			return err
		}
		spec.list = &ls
	case KindPicker:
		return collectionFail(file, element, "picker must be the surface root")
	case KindKeyHelp:
		if len(element.Children) > 0 {
			return collectionFail(file, element, "tmt-key-help binds its model and has no children")
		}
		path, ok := element.Attributes["bind"]
		if !ok {
			return collectionFail(file, element, "tmt-key-help requires bind")
		}
		delete(element.Attributes, "bind")
		headingToken := clistyle.RoleMuted
		if v, ok := element.Attributes["heading-token"]; ok {
			delete(element.Attributes, "heading-token")
			role, valid := clistyle.ParseRole(v)
			if !valid {
				return collectionFail(file, element, "heading-token requires an existing theme role")
			}
			headingToken = role
		}
		headingBold := false
		if v, ok := element.Attributes["heading-bold"]; ok {
			delete(element.Attributes, "heading-bold")
			switch v {
			case "true":
				headingBold = true
			case "false":
				headingBold = false
			default:
				return collectionFail(file, element, "heading-bold must be true or false")
			}
		}
		sectionGap := element.Style.Gap[1]
		if v, ok := element.Attributes["section-gap"]; ok {
			delete(element.Attributes, "section-gap")
			n, err := parseCells(v)
			if err != nil {
				return collectionFail(file, element, "section-gap requires an integer from 0 to 4096")
			}
			sectionGap = n
		}
		proto, err := Parse(file, helpRowsTemplate)
		if err != nil {
			return err
		}
		heading := &proto.Children[0].Children[0].Children[0]
		ht := headingToken
		heading.Style.Token = &ht
		heading.Style.Bold = headingBold
		element.Style.Gap[1] = sectionGap
		proto.Children[0].Attributes["each"] = path + ".sections"
		var locate func(el *MarkupElement, loc Location)
		locate = func(el *MarkupElement, loc Location) {
			el.Location = loc
			for i := range el.Children {
				locate(&el.Children[i], loc)
			}
		}
		locate(proto, element.Location)
		element.Kind = KindCol
		element.Style.Direction = DirectionColumn
		element.Children = proto.Children
		spec.helpIDs = append(spec.helpIDs, append([]string(nil), *ids...))
	}
	if _, hasSlot := element.Attributes["slot"]; hasSlot {
		return collectionFail(file, element, "slots belong only to direct modal footer/status text")
	}
	for i := range element.Children {
		if err := lowerSurface(file, &element.Children[i], ids, dynamic, spec, counts, schema); err != nil {
			return err
		}
	}
	*ids = (*ids)[:prevLen]
	return nil
}

func (t *SurfaceTemplate[S]) Materialize(file string, data any, sources Sources[S]) (*ModalSurface, error) {
	node, err := t.binding.Materialize(file, data, sources)
	if err != nil {
		return nil, err
	}
	var rows []ListRow
	if t.spec.list != nil {
		rows, err = extractListRows(file, node, t.spec.list, Location{Line: 1, Column: 1})
		if err != nil {
			return nil, err
		}
	}
	posRoot, err := t.position.Materialize(file, map[string]any{}, sources)
	if err != nil {
		return nil, err
	}
	return &ModalSurface{
		node:     *node,
		position: posRoot.Children[0],
		spec:     t.spec,
		rows:     rows,
	}, nil
}

func containsID(ids [][]string, target []string) bool {
	if len(target) == 0 {
		return false
	}
	for _, id := range ids {
		if slices.Equal(id, target) {
			return true
		}
	}
	return false
}

func helpWidth(node *SceneNode, ids [][]string) int {
	var labels func(n *SceneNode) int
	labels = func(n *SceneNode) int {
		own := 0
		if len(n.ID) > 0 && n.ID[len(n.ID)-1] == "keys" && n.Text != nil {
			own = uniseg.StringWidth(clistyle.Escape(*n.Text))
		}
		for i := range n.Children {
			own = max(own, labels(&n.Children[i]))
		}
		return own
	}
	if containsID(ids, node.ID) {
		return labels(node)
	}
	best := 0
	for i := range node.Children {
		best = max(best, helpWidth(&node.Children[i], ids))
	}
	return best
}

func prepareSurfaceNode(node *SceneNode, ids [][]string, width uint16, inHelp bool, keyWidth int) {
	inHelp = inHelp || containsID(ids, node.ID)
	w := width
	if node.Style.Width.Kind == ExtentCells {
		w = node.Style.Width.Cells
	}
	if node.Style.MaxWidth != nil && w > *node.Style.MaxWidth {
		w = *node.Style.MaxWidth
	}
	pad2 := uint32(node.Style.Padding[0]) * 2
	if uint32(w) > pad2 {
		w -= uint16(pad2)
	} else {
		w = 0
	}
	node.Style.Shrink = 0
	node.Style.Grow = 0
	if inHelp && node.RowID != nil && len(node.Children) == 2 {
		stacked := int(w)-(keyWidth+2) < 20
		if stacked {
			node.Style.Direction = DirectionColumn
			node.Style.Gap = [2]uint16{0, 0}
			node.Children[0].Style.Width = CellsExtent(w)
			node.Children[1].Style.Width = CellsExtent(w)
			zero := uint16(0)
			node.Children[1].Style.MinWidth = &zero
			if w > 2 {
				node.Children[1].Style.Padding[0] = 1
			} else {
				node.Children[1].Style.Padding[0] = 0
			}
		} else {
			node.Style.Direction = DirectionRow
			node.Style.Gap = [2]uint16{2, 0}
			kw := uint16(min(keyWidth, math.MaxUint16))
			node.Children[0].Style.Width = CellsExtent(kw)
			rem := uint16(0)
			if int(w) > keyWidth+2 {
				rem = uint16(int(w) - keyWidth - 2)
			}
			node.Children[1].Style.Width = CellsExtent(rem)
			zero := uint16(0)
			node.Children[1].Style.MinWidth = &zero
		}
	}
	for i := range node.Children {
		prepareSurfaceNode(&node.Children[i], ids, w, inHelp, keyWidth)
	}
}

func paintSurfaceNode(node *SceneNode, area Rect, buffer *Buffer, theme clistyle.Theme, depth clistyle.Depth, selection func(clistyle.Role) Style) error {
	if area.IsEmpty() {
		return nil
	}
	cells, err := Layout(node, [2]uint16{area.Width, area.Height}, MeasureText)
	if err != nil {
		return err
	}
	translateCells(cells, area, 0)
	Paint(cells, buffer, theme, depth, selection)
	return nil
}

// RenderSurface renders a non-list ModalSurface into buffer.
func RenderSurface(scene *ModalSurface, scroll *ScrollState, body Rect, buffer *Buffer, style RenderStyle, selection func(clistyle.Role) Style) (FrameMap, error) {
	if scene.spec.list != nil {
		return FrameMap{}, errors.New("list/table surfaces require render_list and caller ListState")
	}
	return renderSurfaceInner(scene, scroll, body, buffer, style, selection, false, nil)
}

// RenderSurfaceList reconciles state and renders a list/table ModalSurface into buffer.
func RenderSurfaceList(scene *ModalSurface, state *ListState, body Rect, buffer *Buffer, style RenderStyle, selection func(clistyle.Role) Style) (FrameMap, error) {
	if scene.spec.list == nil {
		return FrameMap{}, errors.New("render_list requires a list/table surface")
	}
	if err := state.Reconcile(append([]ListRow(nil), scene.rows...)); err != nil {
		return FrameMap{}, err
	}
	var selPtr *string
	if sel, ok := state.Selected(); ok {
		selPtr = &sel
	}
	return renderSurfaceInner(scene, &state.Scroll, body, buffer, style, selection, true, selPtr)
}

func renderSurfaceInner(
	scene *ModalSurface,
	scroll *ScrollState,
	body Rect,
	buffer *Buffer,
	style RenderStyle,
	selection func(clistyle.Role) Style,
	isList bool,
	selected *string,
) (FrameMap, error) {
	modalNode := &scene.node.Children[0]
	content := cloneSceneNode(modalNode.Children[0])
	if content.Style.Token == nil {
		if modalNode.Style.Token != nil {
			r := *modalNode.Style.Token
			content.Style.Token = &r
		} else if scene.node.Style.Token != nil {
			r := *scene.node.Style.Token
			content.Style.Token = &r
		}
	}
	content.Selected = content.Selected || modalNode.Selected || scene.node.Selected

	var intrinsic func(n *SceneNode) int
	intrinsic = func(n *SceneNode) int {
		own := 0
		if n.Text != nil {
			own = int(MeasureText(*n.Text, n.Style.TextFlow, MaxContentSpace())[0])
		}
		for i := range n.Children {
			own = max(own, intrinsic(&n.Children[i]))
		}
		return own
	}

	var demandWidth uint16
	if modalNode.Style.Width.Kind == ExtentCells {
		demandWidth = modalNode.Style.Width.Cells
	} else {
		dw := intrinsic(&content) + helpWidth(&content, scene.spec.helpIDs) + 6
		demandWidth = uint16(min(dw, math.MaxUint16))
	}
	if scene.spec.list != nil {
		selectListRow(&content, scene.spec.list, selected)
	}
	var authoredHeight *uint16
	if modalNode.Style.Height.Kind == ExtentCells {
		h := modalNode.Style.Height.Cells
		authoredHeight = &h
	}
	demandHeight := body.Height
	if authoredHeight != nil {
		demandHeight = *authoredHeight
	}
	clippedBody := body.Intersect(buffer.Area)
	areas := scene.spec.modal.Areas(clippedBody, [2]uint16{demandWidth, demandHeight}, scene.spec.has(modalSlotFooter), scene.spec.has(modalSlotStatus))

	slotLines := func(target modalSlot) uint16 {
		for i, sk := range scene.spec.slots {
			if sk == target && i+1 < len(modalNode.Children) {
				child := &modalNode.Children[i+1]
				if child.Text == nil {
					return 1
				}
				return max(MeasureText(*child.Text, child.Style.TextFlow, CellsSpace(areas.Content.Width))[1], 1)
			}
		}
		return 0
	}
	footerLines := slotLines(modalSlotFooter)
	statusLines := slotLines(modalSlotStatus)
	areas = scene.spec.modal.areasWithLines(clippedBody, [2]uint16{demandWidth, demandHeight}, footerLines, statusLines)
	if scene.spec.has(modalSlotQuery) && areas.Content.Height > 0 {
		areas.Content.Y++
		areas.Content.Height--
	}

	kw := helpWidth(&content, scene.spec.helpIDs)
	prepareSurfaceNode(&content, scene.spec.helpIDs, areas.Content.Width, false, kw)
	content.Style.Height = CellsExtent(math.MaxUint16)
	cells, err := Layout(&content, [2]uint16{areas.Content.Width, math.MaxUint16}, MeasureText)
	if err != nil {
		return FrameMap{}, err
	}
	rows, err := measureCellsHeight(cells)
	if err != nil {
		return FrameMap{}, errors.New("scroll content exceeds 65535 visual lines")
	}
	extra := 3 + int(footerLines) + int(statusLines)
	if scene.spec.has(modalSlotQuery) {
		extra++
	}
	measuredH := uint16(min(rows+extra, math.MaxUint16))
	if authoredHeight != nil {
		demandHeight = *authoredHeight
	} else {
		demandHeight = measuredH
	}
	areas = scene.spec.modal.areasWithLines(clippedBody, [2]uint16{demandWidth, demandHeight}, footerLines, statusLines)
	var queryRect Rect
	if scene.spec.has(modalSlotQuery) {
		qh := uint16(0)
		if areas.Content.Height > 0 {
			qh = 1
		}
		queryRect = NewRect(areas.Content.X, areas.Content.Y, areas.Content.Width, qh)
		areas.Content.Y += qh
		areas.Content.Height -= qh
	}

	var listFrame *ListFrame
	if isList {
		lf := publishListFrame(cells, scene.spec.list.id, scroll, scene.rows, selected, areas.Content, rows)
		listFrame = &lf
	} else {
		scroll.Update(areas.Content, rows, nil)
	}
	translateCells(cells, areas.Content, scroll.Offset())
	scene.spec.modal.Paint(areas, buffer, style.Theme, style.Depth)
	rawHits := Paint(cells, buffer, style.Theme, style.Depth, selection)
	var hits []SurfaceHit
	for _, h := range rawHits {
		if len(h.ID) > 0 {
			hits = append(hits, SurfaceHit{
				Rect:  NewRect(uint16(h.Rect.X), uint16(h.Rect.Y), uint16(h.Rect.Width), uint16(h.Rect.Height)),
				ID:    append([]string(nil), h.ID...),
				RowID: h.RowID,
			})
		}
	}
	for i, sk := range scene.spec.slots {
		if i+1 >= len(modalNode.Children) {
			break
		}
		var slotArea Rect
		switch sk {
		case modalSlotFooter:
			slotArea = areas.Footer
		case modalSlotStatus:
			slotArea = areas.Status
		case modalSlotQuery:
			slotArea = queryRect
		}
		if err := paintSurfaceNode(&modalNode.Children[i+1], slotArea, buffer, style.Theme, style.Depth, selection); err != nil {
			return FrameMap{}, err
		}
	}

	posNode := cloneSceneNode(scene.position)
	posText := ""
	if read, ok := scroll.OverflowPosition(); ok {
		if listFrame != nil {
			posText = selectablePosition(listFrame)
		} else {
			posText = read
		}
	}
	posNode.Text = &posText
	if err := paintSurfaceNode(&posNode, areas.Position, buffer, style.Theme, style.Depth, selection); err != nil {
		return FrameMap{}, err
	}
	return FrameMap{
		Areas: areas,
		Hits:  hits,
		List:  listFrame,
		Query: queryRect,
	}, nil
}

func selectablePosition(list *ListFrame) string {
	var selectable []string
	for _, r := range list.Rows {
		if !r.Disabled {
			selectable = append(selectable, r.ID)
		}
	}
	first, last := -1, -1
	for _, g := range list.Geometry {
		if g.Visible.Height == 0 {
			continue
		}
		idx := slices.Index(selectable, g.ID)
		if idx < 0 {
			continue
		}
		if first < 0 || idx < first {
			first = idx
		}
		if idx > last {
			last = idx
		}
	}
	if first < 0 {
		return ""
	}
	below := len(selectable) - last - 1
	if below > 0 {
		return fmt.Sprintf("%d–%d of %d · %d more ↓", first+1, last+1, len(selectable), below)
	}
	return fmt.Sprintf("%d–%d of %d", first+1, last+1, len(selectable))
}
