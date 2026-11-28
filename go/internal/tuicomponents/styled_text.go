package tuicomponents

import "github.com/rivo/uniseg"

// TextSpan is a single role-styled span inside Text.
type TextSpan struct {
	Text string `json:"text"`
	Role Token  `json:"role"`
	Bold bool   `json:"bold"`
}

// TextProps configures Text.
type TextProps struct {
	Spans []TextSpan `json:"spans"`
}

// Text renders a single line of role-styled text: `used  840M`.
// Complete graphemes are clipped at the available width.
type Text struct{}

func (Text) Measure(props TextProps, constraints Constraints) Size {
	width := 0
	for _, span := range props.Spans {
		width += uniseg.StringWidth(SingleLine(span.Text))
	}
	return constraints.Clamp(Size{
		Width:  clampU16(width),
		Height: 1,
	})
}

func (Text) Render(props TextProps, area Rect, grid *CellGrid) []Hit {
	grid.Clear(area)
	x := area.X
	end := satAddU16(area.X, area.Width)
	for _, span := range props.Spans {
		available := satSubU16(end, x)
		text := SingleLine(span.Text)
		spanArea := area
		spanArea.X = x
		spanArea.Width = available
		grid.TextBold(spanArea, text, span.Role.Role(), nil, span.Bold)
		x = satAddU16(x, uint16(min(uniseg.StringWidth(text), int(available))))
	}
	return nil
}
