package tui

import "github.com/tmt-ninja/tmt/go/internal/clistyle"

// SwitchOf identifies what width a tmt-switch measures.
type SwitchOf uint8

const (
	// SwitchOfContainer measures the content width of the switch's parent box.
	SwitchOfContainer SwitchOf = iota
	// SwitchOfTerminal measures the viewport width given to Layout.
	SwitchOfTerminal
)

// CondKind distinguishes none, switch, and case conditions.
type CondKind uint8

const (
	CondNone CondKind = iota
	CondSwitch
	CondCase
)

// Cond is the condition carried by Switch, Case, or Default nodes.
type Cond struct {
	Kind CondKind
	Of   SwitchOf
	Min  uint16
}

// SceneNode is a materialized scene tree node consumed by Layout and Paint.
type SceneNode struct {
	Kind     Kind
	Cond     Cond
	Style    CellStyle
	ID       []string
	RowID    *string
	Selected bool
	Text     *string
	Token    *clistyle.Role
	Children []SceneNode
}
