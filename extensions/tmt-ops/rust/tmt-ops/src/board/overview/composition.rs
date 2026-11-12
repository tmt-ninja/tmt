//! The Agents list body and the Measure column, with Usage above both.
pub(in crate::board) mod lower;
pub(in crate::board) mod measure;
#[cfg(test)]
mod tests;

/// Rows the Agents list keeps while the Usage band grows.
pub(in crate::board) fn minimum_height() -> u16 {
    5
}
