package tuicomponents

import (
	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// TotalsColumn defines one column in a TotalsTable.
type TotalsColumn struct {
	Header       string `json:"header"`
	Width        uint16 `json:"width"`
	Role         Token  `json:"role"`
	RightAligned bool   `json:"right_aligned"`
}

// TotalsRow defines one data row in a TotalsTable.
type TotalsRow struct {
	Values   []string `json:"values"`
	Selected bool     `json:"selected"`
	ID       *HitId   `json:"id"`
}

// TotalsTableProps configures TotalsTable.
type TotalsTableProps struct {
	Columns []TotalsColumn `json:"columns"`
	Rows    []TotalsRow    `json:"rows"`
}

// TotalsTable renders whole aligned columns of caller-formatted totals or matrix values.
// Columns that do not fit, including a value wider than its column, are omitted.
type TotalsTable struct{}

func (TotalsTable) Measure(props TotalsTableProps, constraints Constraints) Size {
	width := 0
	for _, c := range props.Columns {
		width += int(c.Width)
	}
	if len(props.Columns) > 0 {
		width += len(props.Columns) - 1
	}
	return constraints.Clamp(Size{
		Width:  clampU16(width),
		Height: clampU16(len(props.Rows) + 1),
	})
}

func (TotalsTable) Render(props TotalsTableProps, area Rect, grid *CellGrid) []Hit {
	grid.Clear(area)
	x := area.X
	end := satAddU16(area.X, area.Width)
	for index, column := range props.Columns {
		header := SingleLine(column.Header)
		fitsValues := uniseg.StringWidth(header) <= int(column.Width)
		if fitsValues {
			for _, row := range props.Rows {
				if index < len(row.Values) && uniseg.StringWidth(SingleLine(row.Values[index])) > int(column.Width) {
					fitsValues = false
					break
				}
			}
		}
		if !fitsValues || column.Width > satSubU16(end, x) {
			continue
		}
		var headerOffset uint16
		if column.RightAligned {
			headerOffset = satSubU16(column.Width, uint16(uniseg.StringWidth(header)))
		}
		grid.Text(Rect{
			X:      x + headerOffset,
			Y:      area.Y,
			Width:  column.Width - headerOffset,
			Height: min(area.Height, 1),
		}, header, clistyle.RoleMuted, nil)

		visibleRows := min(len(props.Rows), int(satSubU16(area.Height, 1)))
		for rowIndex := 0; rowIndex < visibleRows; rowIndex++ {
			row := props.Rows[rowIndex]
			if index < len(row.Values) {
				value := SingleLine(row.Values[index])
				var offset uint16
				if column.RightAligned {
					offset = satSubU16(column.Width, uint16(uniseg.StringWidth(value)))
				}
				grid.Text(Rect{
					X:      x + offset,
					Y:      satAddU16(area.Y, uint16(rowIndex+1)),
					Width:  column.Width - offset,
					Height: 1,
				}, value, column.Role.Role(), nil)
			}
		}
		x = satAddU16(satAddU16(x, column.Width), 1)
	}

	var hits []Hit
	size := grid.Size()
	visibleRows := min(len(props.Rows), int(satSubU16(area.Height, 1)))
	for index := 0; index < visibleRows; index++ {
		row := props.Rows[index]
		y := satAddU16(area.Y, uint16(index+1))
		if row.Selected {
			for cx := area.X; cx < min(end, size.Width); cx++ {
				if cell := grid.Get(cx, y); cell != nil {
					c := cloneCell(*cell)
					c.Underlay = rolePtr(clistyle.RoleSelection)
					grid.Set(cx, y, c)
				}
			}
		}
		if y < size.Height && row.ID != nil {
			width := satSubU16(min(end, size.Width), area.X)
			if width > 0 {
				hits = append(hits, Hit{
					Rect: Rect{X: area.X, Y: y, Width: width, Height: 1},
					ID:   *row.ID,
				})
			}
		}
	}
	return hits
}
