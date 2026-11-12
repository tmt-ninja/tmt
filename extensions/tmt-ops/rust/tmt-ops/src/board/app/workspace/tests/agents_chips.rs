//! The Agents tab keeps its squad tree without list-mode controls.
use super::*;
use crate::board::shell::OpsTab;
use ratatui::crossterm::event::KeyCode;

#[test]
fn agents_tab_keeps_the_squad_tree_without_filter_chips() {
    let mut app = board();
    app.shell.tab = OpsTab::Agents;
    let before = app.workspace.selected.clone();
    let tree = paint(&app, 160, 40).join("\n");
    assert!(tree.contains("SQUAD / AGENT"), "{tree}");
    assert!(!tree.contains("Pinned"), "{tree}");
    assert_eq!(key(&mut app, KeyCode::Char('f')), Effect::None);
    assert_eq!(app.workspace.selected, before);
}
