//! Application-neutral components implementing the Full-screen interaction
//! contract in `design/cli-style.md`. Markup is admitted by `surface::compile`.
mod button;
pub mod collection;
pub use button::{Button, ButtonRow};
mod completion;
pub use completion::{Candidate, Completion};

mod dialog;
pub use dialog::{
    Dialog, DialogHits, DialogInput, DialogKind, DialogLook, DialogState, FieldKind, Focus,
};

mod chip_row;
mod editor;
mod gauge;
mod key_help;
mod list;
mod modal;
mod outline;
mod picker;
mod scroll;
mod section_rule;
mod sparkline;
mod stacked_bars;
mod status;
pub mod strip;
pub mod surface;
pub mod terminal;
mod totals_table;

pub use chip_row::{Chip, ChipRow};
pub use gauge::Gauge;
pub use key_help::{KeyHelp, KeyHelpEntry, KeyHelpSection, KeyHint, footer};
pub use modal::{Modal, ModalAreas, Placement};
pub use outline::Outline;
pub use scroll::{ScrollState, Step};
pub use section_rule::SectionRule;
pub use sparkline::Sparkline;
pub use stacked_bars::StackedBars;
pub use status::{StatusLabel, StatusSlot};
pub use totals_table::TotalsTable;

pub use collection::Table;
pub use list::{ListEvent, ListFrame, ListRow, ListState, RowGeometry};
pub use picker::{MAX_QUERY_BYTES, Picker, PickerEvent, PickerField, PickerInput};

pub use editor::{Editor, EditorCell, EditorLayout, EditorLine, Fold};
