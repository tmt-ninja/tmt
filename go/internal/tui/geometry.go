package tui

import (
	"errors"
	"math"
)

// LayoutRect is a signed-origin cell rectangle produced by Layout.
type LayoutRect struct {
	X      int32
	Y      int32
	Width  uint32
	Height uint32
}

// Intersect returns the overlapping rectangle of r and other.
func (r LayoutRect) Intersect(other LayoutRect) LayoutRect {
	x := max(r.X, other.X)
	y := max(r.Y, other.Y)
	right := min(int64(r.X)+int64(r.Width), int64(other.X)+int64(other.Width))
	bottom := min(int64(r.Y)+int64(r.Height), int64(other.Y)+int64(other.Height))
	var w, h uint32
	if right > int64(x) {
		w = uint32(right - int64(x))
	}
	if bottom > int64(y) {
		h = uint32(bottom - int64(y))
	}
	return LayoutRect{X: x, Y: y, Width: w, Height: h}
}

// SpaceKind classifies the available width passed to MeasureTextFunc.
type SpaceKind uint8

const (
	SpaceCells SpaceKind = iota
	SpaceMinContent
	SpaceMaxContent
)

// Space is the cell constraint delivered to the text measurer.
type Space struct {
	Kind  SpaceKind
	Cells uint16
}

func CellsSpace(n uint16) Space { return Space{Kind: SpaceCells, Cells: n} }
func MinContentSpace() Space    { return Space{Kind: SpaceMinContent} }
func MaxContentSpace() Space    { return Space{Kind: SpaceMaxContent} }

// MeasureTextFunc measures intrinsic text width and height for a given flow and space.
type MeasureTextFunc func(text string, flow TextFlow, space Space) [2]uint16

// LayoutCell holds the computed geometry for one materialized SceneNode.
type LayoutCell struct {
	Node        *SceneNode
	Parent      *int
	Rect        LayoutRect
	Content     LayoutRect
	Clip        LayoutRect
	TextWidth   uint16
	Cut         bool
	Overflowing bool
}

type pendingSwitch struct {
	sw     *SceneNode
	parent int
}

type layoutNode struct {
	node     *SceneNode
	parent   *int
	children []*layoutNode

	// Effective style overrides (root auto -> viewport).
	width  Extent
	height Extent

	// Unrounded layout relative to parent.
	rawX, rawY         float64
	rawW, rawH         float64
	contentW, contentH float64
}

type availKind uint8

const (
	availDefinite availKind = iota
	availMinContent
	availMaxContent
)

type availSpace struct {
	kind availKind
	val  float64
}

func definiteAvail(v float64) availSpace { return availSpace{kind: availDefinite, val: max(0, v)} }
func minAvail() availSpace               { return availSpace{kind: availMinContent} }
func maxAvail() availSpace               { return availSpace{kind: availMaxContent} }

func budget(width float64) uint16 {
	v := math.Floor(width)
	if v <= 0 || math.IsNaN(v) {
		return 0
	}
	if v >= math.MaxUint16 {
		return math.MaxUint16
	}
	return uint16(v)
}

func laidOutChildren(node *SceneNode, parent int, choices map[*SceneNode]int, pending *[]pendingSwitch, out *[]*SceneNode) {
	for i := range node.Children {
		child := &node.Children[i]
		if child.Kind != KindSwitch {
			*out = append(*out, child)
		} else if branch, ok := choices[child]; ok {
			laidOutChildren(&child.Children[branch], parent, choices, pending, out)
		} else {
			*pending = append(*pending, pendingSwitch{sw: child, parent: parent})
		}
	}
}

func buildLayoutTree(
	entries *[]*layoutNode,
	node *SceneNode,
	parent *int,
	depth int,
	choices map[*SceneNode]int,
	pending *[]pendingSwitch,
) (*layoutNode, error) {
	if depth >= MaxDepth || len(*entries) >= MaxNodes {
		return nil, errors.New("geometry exceeds scene depth/node limit")
	}
	if node.Style.ColSpan == 0 {
		return nil, errors.New("inadmissible grid span/minmax minimum")
	}
	for _, tr := range node.Style.Columns {
		if tr.Min.Kind == BreadthFraction {
			return nil, errors.New("inadmissible grid span/minmax minimum")
		}
	}

	idx := len(*entries)
	ln := &layoutNode{
		node:   node,
		parent: parent,
		width:  node.Style.Width,
		height: node.Style.Height,
	}
	*entries = append(*entries, ln)

	var flat []*SceneNode
	laidOutChildren(node, idx, choices, pending, &flat)
	if len(flat) > 0 {
		ln.children = make([]*layoutNode, len(flat))
		for i, child := range flat {
			p := idx
			cln, err := buildLayoutTree(entries, child, &p, depth+1, choices, pending)
			if err != nil {
				return nil, err
			}
			ln.children[i] = cln
		}
	}
	return ln, nil
}

// Layout computes cell geometry for root in viewport, resolving any tmt-switch
// branches top-down without re-measuring unchosen branches.
func Layout(root *SceneNode, viewport [2]uint16, measureText MeasureTextFunc) ([]LayoutCell, error) {
	choices := make(map[*SceneNode]int)
	for {
		cells, pending, err := solveLayout(root, viewport, choices, measureText)
		if err != nil {
			return nil, err
		}
		if len(pending) == 0 {
			return cells, nil
		}
		for _, p := range pending {
			width := cells[p.parent].Content.Width
			if p.sw.Cond.Kind == CondSwitch && p.sw.Cond.Of == SwitchOfTerminal {
				width = uint32(viewport[0])
			}
			branch := len(p.sw.Children) - 1
			for i := range p.sw.Children {
				c := p.sw.Children[i].Cond
				if c.Kind != CondCase || width >= uint32(c.Min) {
					branch = i
					break
				}
			}
			choices[p.sw] = branch
		}
	}
}

func solveLayout(
	root *SceneNode,
	viewport [2]uint16,
	choices map[*SceneNode]int,
	measureText MeasureTextFunc,
) ([]LayoutCell, []pendingSwitch, error) {
	var entries []*layoutNode
	var pending []pendingSwitch
	rootNode, err := buildLayoutTree(&entries, root, nil, 0, choices, &pending)
	if err != nil {
		return nil, nil, err
	}
	if rootNode.width.Kind == ExtentAuto {
		rootNode.width = CellsExtent(viewport[0])
	}
	if rootNode.height.Kind == ExtentAuto {
		rootNode.height = CellsExtent(viewport[1])
	}

	vpW := float64(viewport[0])
	vpH := float64(viewport[1])
	computeNode(rootNode, nil, nil, definiteAvail(vpW), definiteAvail(vpH), measureText, true)

	vpRect := LayoutRect{Width: uint32(viewport[0]), Height: uint32(viewport[1])}
	result := make([]LayoutCell, len(entries))
	origins := make([][2]float64, len(entries))

	for i, ln := range entries {
		var px, py float64
		if ln.parent != nil {
			px = origins[*ln.parent][0]
			py = origins[*ln.parent][1]
		}
		ox := px + ln.rawX
		oy := py + ln.rawY
		origins[i] = [2]float64{ox, oy}

		x0 := math.Round(ox)
		y0 := math.Round(oy)
		x1 := math.Round(ox + ln.rawW)
		y1 := math.Round(oy + ln.rawH)
		var rw, rh uint32
		if x1 > x0 {
			rw = uint32(x1 - x0)
		}
		if y1 > y0 {
			rh = uint32(y1 - y0)
		}
		rect := LayoutRect{
			X:      int32(x0),
			Y:      int32(y0),
			Width:  rw,
			Height: rh,
		}
		padX := uint32(ln.node.Style.Padding[0])
		padY := uint32(ln.node.Style.Padding[1])
		var cw, ch uint32
		if rect.Width > 2*padX {
			cw = rect.Width - 2*padX
		}
		if rect.Height > 2*padY {
			ch = rect.Height - 2*padY
		}
		content := LayoutRect{
			X:      rect.X + int32(padX),
			Y:      rect.Y + int32(padY),
			Width:  cw,
			Height: ch,
		}
		ancestor := vpRect
		if ln.parent != nil {
			ancestor = result[*ln.parent].Content.Intersect(result[*ln.parent].Clip)
		}
		clip := rect.Intersect(ancestor)
		cut := ln.parent != nil &&
			result[*ln.parent].Node.Style.Display == DisplayGrid &&
			clip.Width > 0 &&
			clip.Width < rect.Width
		if cut && clip.Width < 4 {
			clip.Width = 0
			clip.Height = 0
		}
		tw := min(budget(ln.rawW-2*float64(padX)), uint16(min(content.Width, math.MaxUint16)))
		roundedContentW := uint32(max(0, int64(math.Round(ln.contentW))))
		roundedContentH := uint32(max(0, int64(math.Round(ln.contentH))))
		overflowing := roundedContentW > rect.Width || roundedContentH > rect.Height

		result[i] = LayoutCell{
			Node:        ln.node,
			Parent:      ln.parent,
			Rect:        rect,
			Content:     content,
			Clip:        clip,
			TextWidth:   tw,
			Cut:         cut,
			Overflowing: overflowing,
		}
	}
	return result, pending, nil
}

func resolveExtent(ext Extent, parent availSpace) (float64, bool) {
	switch ext.Kind {
	case ExtentCells:
		return float64(ext.Cells), true
	case ExtentFull:
		if parent.kind == availDefinite {
			return parent.val, true
		}
		return 0, false
	case ExtentPercent:
		if parent.kind == availDefinite {
			return parent.val * float64(ext.Percent) / 100.0, true
		}
		return 0, false
	default:
		return 0, false
	}
}

func clampWidth(w float64, style *CellStyle) float64 {
	if style.MaxWidth != nil && w > float64(*style.MaxWidth) {
		w = float64(*style.MaxWidth)
	}
	if style.MinWidth != nil && w < float64(*style.MinWidth) {
		w = float64(*style.MinWidth)
	}
	if w < 0 {
		return 0
	}
	return w
}

func computeNode(
	ln *layoutNode,
	knownW, knownH *float64,
	availW, availH availSpace,
	measureText MeasureTextFunc,
	commit bool,
) (float64, float64) {
	s := &ln.node.Style
	padX := float64(s.Padding[0])
	padY := float64(s.Padding[1])

	// Resolve explicit outer width/height if not already forced by parent.
	var resolvedW, resolvedH *float64
	if knownW != nil {
		v := max(0, *knownW)
		resolvedW = &v
	} else if v, ok := resolveExtent(ln.width, availW); ok {
		v = clampWidth(v, s)
		resolvedW = &v
	}
	if knownH != nil {
		v := max(0, *knownH)
		resolvedH = &v
	} else if v, ok := resolveExtent(ln.height, availH); ok {
		v = max(0, v)
		resolvedH = &v
	}

	if len(ln.children) == 0 {
		var measW, measH float64
		if ln.node.Text != nil && *ln.node.Text != "" {
			var sp Space
			if resolvedW != nil {
				sp = CellsSpace(budget(max(0, *resolvedW-2*padX)))
			} else {
				switch availW.kind {
				case availDefinite:
					sp = CellsSpace(budget(max(0, availW.val-2*padX)))
				case availMinContent:
					sp = MinContentSpace()
				case availMaxContent:
					sp = MaxContentSpace()
				}
			}
			m := measureText(*ln.node.Text, s.TextFlow, sp)
			measW = float64(m[0]) + 2*padX
			measH = float64(m[1]) + 2*padY
		} else {
			measW = 2 * padX
			measH = 2 * padY
		}

		w := measW
		if resolvedW != nil {
			w = *resolvedW
		} else {
			w = clampWidth(w, s)
		}
		h := measH
		if resolvedH != nil {
			h = *resolvedH
		}
		if commit {
			ln.rawW = w
			ln.rawH = h
			ln.contentW = max(w, measW)
			ln.contentH = max(h, measH)
		}
		return w, h
	}

	if s.Display == DisplayGrid {
		return computeGrid(ln, resolvedW, resolvedH, availW, availH, measureText, commit)
	}
	return computeFlex(ln, resolvedW, resolvedH, availW, availH, measureText, commit)
}

func computeFlex(
	ln *layoutNode,
	resolvedW, resolvedH *float64,
	availW, availH availSpace,
	measureText MeasureTextFunc,
	commit bool,
) (float64, float64) {
	s := &ln.node.Style
	padX := float64(s.Padding[0])
	padY := float64(s.Padding[1])
	isRow := s.Direction == DirectionRow
	mainGap := float64(s.Gap[0])
	if !isRow {
		mainGap = float64(s.Gap[1])
	}

	var innerAvailW, innerAvailH availSpace
	if resolvedW != nil {
		innerAvailW = definiteAvail(max(0, *resolvedW-2*padX))
	} else if availW.kind == availDefinite {
		innerAvailW = definiteAvail(max(0, availW.val-2*padX))
	} else {
		innerAvailW = availW
	}
	if resolvedH != nil {
		innerAvailH = definiteAvail(max(0, *resolvedH-2*padY))
	} else if availH.kind == availDefinite {
		innerAvailH = definiteAvail(max(0, availH.val-2*padY))
	} else {
		innerAvailH = availH
	}

	var containerMain availSpace
	var containerCross availSpace
	var definiteMain, definiteCross bool
	if isRow {
		containerMain = innerAvailW
		containerCross = innerAvailH
		definiteMain = resolvedW != nil
		definiteCross = resolvedH != nil
	} else {
		containerMain = innerAvailH
		containerCross = innerAvailW
		definiteMain = resolvedH != nil
		definiteCross = resolvedW != nil
	}

	n := len(ln.children)
	type flexItem struct {
		child  *layoutNode
		base   float64
		hypo   float64
		minM   float64
		maxM   float64
		grow   float64
		shrink float64
		target float64
		frozen bool
		cross  float64
	}
	items := make([]flexItem, n)
	totalGaps := 0.0
	if n > 1 {
		totalGaps = mainGap * float64(n-1)
	}

	// Step 1: Determine flex base size and hypothetical main size.
	for i, child := range ln.children {
		cs := &child.node.Style
		it := flexItem{
			child:  child,
			minM:   0,
			maxM:   math.Inf(1),
			grow:   float64(cs.Grow),
			shrink: float64(cs.Shrink),
		}
		if isRow {
			if cs.MinWidth != nil {
				it.minM = float64(*cs.MinWidth)
			}
			if cs.MaxWidth != nil {
				it.maxM = float64(*cs.MaxWidth)
			}
		}

		// Determine base size: basis -> main size -> intrinsic measurement.
		if b, ok := resolveExtent(cs.Basis, containerMain); ok {
			it.base = max(0, b)
		} else if isRow {
			if w, ok := resolveExtent(child.width, containerMain); ok {
				it.base = max(0, w)
			} else {
				mw, _ := computeNode(child, nil, nil, maxAvail(), innerAvailH, measureText, false)
				it.base = mw
			}
		} else {
			if h, ok := resolveExtent(child.height, containerMain); ok {
				it.base = max(0, h)
			} else {
				// For column flex items, cross width is known/available first.
				var cw *float64
				if w, ok := resolveExtent(child.width, innerAvailW); ok {
					v := clampWidth(w, cs)
					cw = &v
				} else if definiteCross {
					v := clampWidth(containerCross.val, cs)
					cw = &v
				}
				_, mh := computeNode(child, cw, nil, innerAvailW, maxAvail(), measureText, false)
				it.base = mh
			}
		}

		it.hypo = min(max(it.base, it.minM), it.maxM)
		it.target = it.hypo
		items[i] = it
	}

	// Step 2: Resolve flexible lengths if container main size is definite (or available definite for flexing).
	if definiteMain || containerMain.kind == availDefinite {
		availMain := containerMain.val
		usedHypo := totalGaps
		for _, it := range items {
			usedHypo += it.hypo
		}
		growing := availMain > usedHypo
		for i := range items {
			it := &items[i]
			if (growing && it.grow == 0) || (!growing && it.shrink == 0) ||
				(growing && it.base > it.hypo) || (!growing && it.base < it.hypo) {
				it.frozen = true
			}
		}
		for {
			allFrozen := true
			var sumFlex, sumScaledShrink float64
			freeSpace := availMain - totalGaps
			for _, it := range items {
				if it.frozen {
					freeSpace -= it.target
				} else {
					allFrozen = false
					freeSpace -= it.base
					sumFlex += it.grow
					sumScaledShrink += it.shrink * it.base
				}
			}
			if allFrozen {
				break
			}
			// Distribute remaining free space.
			if growing && freeSpace > 0 && sumFlex > 0 {
				factor := max(sumFlex, 1.0)
				for i := range items {
					if !items[i].frozen {
						items[i].target = items[i].base + freeSpace*(items[i].grow/factor)
					}
				}
			} else if !growing && freeSpace < 0 && sumScaledShrink > 0 {
				for i := range items {
					if !items[i].frozen {
						scaled := items[i].shrink * items[i].base
						items[i].target = items[i].base + freeSpace*(scaled/sumScaledShrink)
					}
				}
			} else {
				for i := range items {
					if !items[i].frozen {
						items[i].target = items[i].base
					}
				}
			}

			// Clamp and check violations.
			totalViolation := 0.0
			violations := make([]float64, n)
			for i := range items {
				if items[i].frozen {
					continue
				}
				clamped := min(max(items[i].target, items[i].minM), items[i].maxM)
				violations[i] = clamped - items[i].target
				totalViolation += violations[i]
				items[i].target = clamped
			}
			if totalViolation == 0 {
				break
			}
			for i := range items {
				if items[i].frozen {
					continue
				}
				if (totalViolation > 0 && violations[i] > 0) || (totalViolation < 0 && violations[i] < 0) {
					items[i].frozen = true
				}
			}
		}
	}

	// Step 3: Determine cross size of each child and container cross size.
	maxCross := 0.0
	for i := range items {
		it := &items[i]
		cs := &it.child.node.Style
		if isRow {
			if h, ok := resolveExtent(it.child.height, containerCross); ok {
				it.cross = max(0, h)
			} else if definiteCross {
				it.cross = containerCross.val
			} else {
				w := it.target
				_, mh := computeNode(it.child, &w, nil, innerAvailW, innerAvailH, measureText, false)
				it.cross = mh
			}
		} else {
			if w, ok := resolveExtent(it.child.width, containerCross); ok {
				it.cross = clampWidth(w, cs)
			} else if definiteCross {
				it.cross = clampWidth(containerCross.val, cs)
			} else {
				h := it.target
				mw, _ := computeNode(it.child, nil, &h, innerAvailW, innerAvailH, measureText, false)
				it.cross = clampWidth(mw, cs)
			}
		}
		if it.cross > maxCross {
			maxCross = it.cross
		}
	}

	// Stretch auto-cross children to line cross size when container cross is auto.
	lineCross := maxCross
	if definiteCross {
		lineCross = containerCross.val
	}
	for i := range items {
		it := &items[i]
		if isRow && it.child.height.Kind == ExtentAuto {
			it.cross = lineCross
		} else if !isRow && it.child.width.Kind == ExtentAuto {
			it.cross = clampWidth(lineCross, &it.child.node.Style)
		}
	}

	// Step 4: Final layout & positioning of children.
	cursor := 0.0
	var contentMaxX, contentMaxY float64
	for i := range items {
		it := &items[i]
		var cw, ch float64
		if isRow {
			cw, ch = it.target, it.cross
		} else {
			cw, ch = it.cross, it.target
		}
		var cx, cy float64
		if isRow {
			cx = padX + cursor
			cy = padY
		} else {
			cx = padX
			cy = padY + cursor
		}
		if commit {
			it.child.rawX = cx
			it.child.rawY = cy
			computeNode(it.child, &cw, &ch, definiteAvail(cw), definiteAvail(ch), measureText, true)
			contentMaxX = max(contentMaxX, cx+max(it.child.rawW, it.child.contentW))
			contentMaxY = max(contentMaxY, cy+max(it.child.rawH, it.child.contentH))
		}
		cursor += it.target
		if i+1 < n {
			cursor += mainGap
		}
	}

	var outW, outH float64
	if resolvedW != nil {
		outW = *resolvedW
	} else if isRow {
		outW = clampWidth(cursor+2*padX, s)
	} else {
		outW = clampWidth(lineCross+2*padX, s)
	}
	if resolvedH != nil {
		outH = *resolvedH
	} else if isRow {
		outH = lineCross + 2*padY
	} else {
		outH = cursor + 2*padY
	}

	if commit {
		ln.rawW = outW
		ln.rawH = outH
		ln.contentW = max(outW, contentMaxX+padX)
		ln.contentH = max(outH, contentMaxY+padY)
	}
	return outW, outH
}

func computeGrid(
	ln *layoutNode,
	resolvedW, resolvedH *float64,
	availW, availH availSpace,
	measureText MeasureTextFunc,
	commit bool,
) (float64, float64) {
	s := &ln.node.Style
	padX := float64(s.Padding[0])
	padY := float64(s.Padding[1])
	gapX := float64(s.Gap[0])
	gapY := float64(s.Gap[1])

	tracks := s.Columns
	if len(tracks) == 0 {
		tracks = []GridTrack{{Min: AutoBreadth(), Max: AutoBreadth()}}
	}
	numCols := len(tracks)

	var innerW availSpace
	if resolvedW != nil {
		innerW = definiteAvail(max(0, *resolvedW-2*padX))
	} else if availW.kind == availDefinite {
		innerW = definiteAvail(max(0, availW.val-2*padX))
	} else {
		innerW = availW
	}
	var innerH availSpace
	if resolvedH != nil {
		innerH = definiteAvail(max(0, *resolvedH-2*padY))
	} else if availH.kind == availDefinite {
		innerH = definiteAvail(max(0, availH.val-2*padY))
	} else {
		innerH = availH
	}

	// Auto-place children row-major respecting col_span.
	type placement struct {
		child *layoutNode
		col   int
		row   int
		span  int
	}
	placements := make([]placement, len(ln.children))
	curCol, curRow := 0, 0
	numRows := 0
	for i, child := range ln.children {
		span := int(child.node.Style.ColSpan)
		if span < 1 {
			span = 1
		}
		if span > numCols {
			span = numCols
		}
		if curCol > 0 && curCol+span > numCols {
			curCol = 0
			curRow++
		}
		placements[i] = placement{child: child, col: curCol, row: curRow, span: span}
		if curRow+1 > numRows {
			numRows = curRow + 1
		}
		curCol += span
		if curCol >= numCols {
			curCol = 0
			curRow++
		}
	}

	// Column track sizing.
	baseSize := make([]float64, numCols)
	growthLimit := make([]float64, numCols)
	for c, tr := range tracks {
		switch tr.Min.Kind {
		case BreadthCells:
			baseSize[c] = float64(tr.Min.Cells)
		case BreadthPercent:
			if innerW.kind == availDefinite {
				baseSize[c] = innerW.val * float64(tr.Min.Percent) / 100.0
			}
		case BreadthAuto:
			baseSize[c] = 0
		}
		switch tr.Max.Kind {
		case BreadthCells:
			growthLimit[c] = max(baseSize[c], float64(tr.Max.Cells))
		case BreadthPercent:
			if innerW.kind == availDefinite {
				growthLimit[c] = max(baseSize[c], innerW.val*float64(tr.Max.Percent)/100.0)
			} else {
				growthLimit[c] = math.Inf(1)
			}
		default:
			growthLimit[c] = math.Inf(1)
		}
	}

	// Intrinsic sizing for single-span items in Auto columns.
	for _, pl := range placements {
		if pl.span != 1 {
			continue
		}
		c := pl.col
		tr := tracks[c]
		if tr.Min.Kind == BreadthAuto && tr.Max.Kind != BreadthFraction {
			mw, _ := computeNode(pl.child, nil, nil, maxAvail(), innerH, measureText, false)
			if mw > baseSize[c] {
				baseSize[c] = min(mw, growthLimit[c])
			}
		}
	}

	// Expand flexible (fr) tracks.
	totalColGaps := 0.0
	if numCols > 1 {
		totalColGaps = gapX * float64(numCols-1)
	}
	colW := make([]float64, numCols)
	copy(colW, baseSize)

	if innerW.kind == availDefinite {
		isFr := make([]bool, numCols)
		frozen := make([]bool, numCols)
		hasFr := false
		for c, tr := range tracks {
			if tr.Max.Kind == BreadthFraction {
				isFr[c] = true
				hasFr = true
			} else {
				frozen[c] = true
			}
		}
		if hasFr {
			for {
				var used, sumFr float64
				for c := 0; c < numCols; c++ {
					if frozen[c] {
						used += colW[c]
					} else {
						sumFr += float64(tracks[c].Max.Fraction)
					}
				}
				free := max(0, innerW.val-totalColGaps-used)
				if sumFr <= 0 {
					break
				}
				frUnit := free / max(sumFr, 1.0)
				anyFrozen := false
				for c := 0; c < numCols; c++ {
					if frozen[c] || !isFr[c] {
						continue
					}
					share := frUnit * float64(tracks[c].Max.Fraction)
					if share < baseSize[c] {
						colW[c] = baseSize[c]
						frozen[c] = true
						anyFrozen = true
					}
				}
				if !anyFrozen {
					for c := 0; c < numCols; c++ {
						if !frozen[c] && isFr[c] {
							colW[c] = frUnit * float64(tracks[c].Max.Fraction)
						}
					}
					break
				}
			}
		}
	}

	colX := make([]float64, numCols)
	cx := padX
	for c := 0; c < numCols; c++ {
		colX[c] = cx
		cx += colW[c]
		if c+1 < numCols {
			cx += gapX
		}
	}
	totalColsW := cx - padX

	// Row track sizing (implicit auto rows).
	rowH := make([]float64, numRows)
	for _, pl := range placements {
		spanW := 0.0
		for c := pl.col; c < pl.col+pl.span; c++ {
			spanW += colW[c]
		}
		if pl.span > 1 {
			spanW += gapX * float64(pl.span-1)
		}
		_, mh := computeNode(pl.child, &spanW, nil, definiteAvail(spanW), maxAvail(), measureText, false)
		if mh > rowH[pl.row] {
			rowH[pl.row] = mh
		}
	}

	totalRowGaps := 0.0
	if numRows > 1 {
		totalRowGaps = gapY * float64(numRows-1)
	}
	sumRowH := 0.0
	for _, h := range rowH {
		sumRowH += h
	}
	if resolvedH != nil && numRows > 0 {
		freeH := max(0, (*resolvedH-2*padY)-totalRowGaps-sumRowH)
		if freeH > 0 {
			add := freeH / float64(numRows)
			for r := range rowH {
				rowH[r] += add
			}
			sumRowH += freeH
		}
	}

	rowY := make([]float64, numRows)
	cy := padY
	for r := 0; r < numRows; r++ {
		rowY[r] = cy
		cy += rowH[r]
		if r+1 < numRows {
			cy += gapY
		}
	}
	totalRowsH := cy - padY

	// Final layout & positioning of grid children.
	var contentMaxX, contentMaxY float64
	contentMaxX = padX + totalColsW
	contentMaxY = padY + totalRowsH
	for _, pl := range placements {
		spanW := 0.0
		for c := pl.col; c < pl.col+pl.span; c++ {
			spanW += colW[c]
		}
		if pl.span > 1 {
			spanW += gapX * float64(pl.span-1)
		}
		rh := rowH[pl.row]
		if commit {
			pl.child.rawX = colX[pl.col]
			pl.child.rawY = rowY[pl.row]
			computeNode(pl.child, &spanW, &rh, definiteAvail(spanW), definiteAvail(rh), measureText, true)
			contentMaxX = max(contentMaxX, pl.child.rawX+max(pl.child.rawW, pl.child.contentW))
			contentMaxY = max(contentMaxY, pl.child.rawY+max(pl.child.rawH, pl.child.contentH))
		}
	}

	outW := clampWidth(totalColsW+2*padX, s)
	if resolvedW != nil {
		outW = *resolvedW
	}
	outH := totalRowsH + 2*padY
	if resolvedH != nil {
		outH = *resolvedH
	}
	if commit {
		ln.rawW = outW
		ln.rawH = outH
		ln.contentW = max(outW, contentMaxX+padX)
		ln.contentH = max(outH, contentMaxY+padY)
	}
	return outW, outH
}
