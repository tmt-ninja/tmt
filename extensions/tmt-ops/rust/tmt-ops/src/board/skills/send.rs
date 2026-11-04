//! Picked-token provenance and safe editor insertion.
use super::*;

const SKILL: &str = "tmt-skill:";

/// The skill a chosen fold stands for.
pub(in crate::board) fn chosen(fold: &tmt_tui::components::Fold) -> Option<&str> {
    fold.label.strip_prefix(SKILL)
}

/// Replace the typed token with a skill fold over `/name`, then a space, all or nothing.
pub(super) fn insert_skill(
    editor: &mut Editor,
    range: std::ops::Range<usize>,
    candidate: &Candidate,
) -> bool {
    let Some(name) = candidate.insertion.strip_prefix(TRIGGER) else {
        return false;
    };
    let mut next = editor.clone();
    let start = range.start;
    if !next.replace_range(range, "", MESSAGE_LIMIT)
        || !next.insert_folded(
            &candidate.insertion,
            format!("{SKILL}{name}"),
            MESSAGE_LIMIT,
        )
    {
        return false;
    }
    let Some(id) = next
        .folds()
        .iter()
        .find(|fold| fold.source.start == start && chosen(fold).is_some())
        .map(|fold| fold.id)
    else {
        return false;
    };
    if !next.set_expanded(id, true) || !next.insert(" ", MESSAGE_LIMIT) {
        return false;
    }
    *editor = next;
    true
}
