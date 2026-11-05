//! Pure cell-grid components. Callers own data, events, and palette resolution.
mod contract;
mod layout;
mod section_rule;
mod text;
pub use contract::*;
pub use layout::*;
pub use section_rule::*;

mod chip_row;
mod gauge;
mod mark;
mod more_hint;
mod pane_frame;
mod pane_rule;
mod sparkline;
mod stacked_bars;
pub use chip_row::*;
pub use gauge::*;
pub use mark::*;
pub use more_hint::*;
pub use pane_frame::*;
pub use pane_rule::*;
pub use sparkline::*;
pub use stacked_bars::*;

#[cfg(test)]
mod tests;
