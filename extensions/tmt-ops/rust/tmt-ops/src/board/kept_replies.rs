//! Kept replies in one-to-one Talk: Core API projection, selection by key, and clipped hits.
use crate::core::Core;
use ratatui::layout::Rect;
use serde_json::{Value, json};
use std::cell::RefCell;

pub(in crate::board) const DEFAULT_LIST_LIMIT: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Source {
    Request,
    Passthrough,
    Terminal,
}

impl Source {
    pub(in crate::board) fn parse(raw: Option<&str>) -> Self {
        match raw {
            Some("passthrough") => Self::Passthrough,
            Some("terminal") => Self::Terminal,
            _ => Self::Request,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::board) enum KeepReplyState {
    Pending,
    Kept,
    NotKept,
    Removed,
}

impl KeepReplyState {
    pub(in crate::board) fn from_wire(value: &Value) -> Option<Self> {
        match value.as_str()? {
            "pending" => Some(Self::Pending),
            "kept" => Some(Self::Kept),
            "notKept" => Some(Self::NotKept),
            "removed" => Some(Self::Removed),
            _ => None,
        }
    }

    pub(in crate::board) fn active_mark(self) -> bool {
        matches!(self, Self::Pending | Self::Kept)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct KeptReplySummary {
    pub key: String,
    pub member_id: String,
    pub source: Source,
    pub at_ms: u64,
    pub excerpt: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct KeptReplyDetail {
    pub key: String,
    pub member_id: String,
    pub source: Source,
    pub at_ms: u64,
    pub text: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct RowHit {
    pub area: Rect,
    pub member_id: String,
    pub key: String,
}

#[derive(Default, Debug)]
pub(in crate::board) struct KeptRepliesState {
    pub member_id: Option<String>,
    pub items: Vec<KeptReplySummary>,
    pub supported: Option<bool>,
    pub focused: bool,
    pub selected_key: Option<String>,
    pub reader: Option<KeptReplyDetail>,
    pub hits: RefCell<Vec<RowHit>>,
}

impl KeptRepliesState {
    pub(in crate::board) fn invalidate_hits(&self) {
        self.hits.borrow_mut().clear();
    }

    pub(in crate::board) fn clear_for_switch(&mut self, member_id: Option<String>) {
        if self.member_id != member_id {
            self.member_id = member_id;
            self.items.clear();
            self.focused = false;
            self.selected_key = None;
            self.reader = None;
            self.invalidate_hits();
        }
    }

    pub(in crate::board) fn publish(&mut self, member_id: &str, items: Vec<KeptReplySummary>) {
        if self.member_id.as_deref() != Some(member_id) {
            return;
        }
        self.items = items;
        self.reconcile_selection();
    }

    pub(in crate::board) fn reconcile_selection(&mut self) {
        if self.items.is_empty() {
            self.focused = false;
            self.selected_key = None;
            return;
        }
        if let Some(key) = self.selected_key.as_deref()
            && self.items.iter().any(|item| item.key == key)
        {
            return;
        }
        self.selected_key = self
            .focused
            .then(|| self.items.first().map(|item| item.key.clone()))
            .flatten();
    }

    pub(in crate::board) fn focus(&mut self) -> bool {
        if self.items.is_empty() {
            self.focused = false;
            self.selected_key = None;
            return false;
        }
        self.focused = true;
        self.reconcile_selection();
        if self.selected_key.is_none() {
            self.selected_key = self.items.first().map(|item| item.key.clone());
        }
        true
    }

    pub(in crate::board) fn unfocus(&mut self) {
        self.focused = false;
    }

    pub(in crate::board) fn move_selection(&mut self, delta: isize) -> bool {
        if self.items.is_empty() {
            self.selected_key = None;
            return false;
        }
        let current = self
            .selected_key
            .as_deref()
            .and_then(|key| self.items.iter().position(|item| item.key == key))
            .unwrap_or(0);
        let max_idx = self.items.len() - 1;
        let next = (current as isize + delta).clamp(0, max_idx as isize) as usize;
        let next_key = self.items[next].key.clone();
        let changed = self.selected_key.as_deref() != Some(next_key.as_str());
        self.selected_key = Some(next_key);
        changed
    }

    pub(in crate::board) fn selected_item(&self) -> Option<&KeptReplySummary> {
        let key = self.selected_key.as_deref()?;
        self.items.iter().find(|item| item.key == key)
    }

    pub(in crate::board) fn remove_confirmed(&mut self, member_id: &str, key: &str) -> bool {
        if self.member_id.as_deref() != Some(member_id) {
            return false;
        }
        let Some(pos) = self.items.iter().position(|item| item.key == key) else {
            return false;
        };
        let next_key = self
            .items
            .get(pos + 1)
            .or_else(|| pos.checked_sub(1).and_then(|prev| self.items.get(prev)))
            .map(|item| item.key.clone());
        self.items.remove(pos);
        if self.selected_key.as_deref() == Some(key) {
            self.selected_key = next_key;
        }
        if self.reader.as_ref().is_some_and(|detail| detail.key == key) {
            self.reader = None;
        }
        self.reconcile_selection();
        true
    }

    pub(in crate::board) fn hit_at(
        &self,
        member_id: &str,
        column: u16,
        row: u16,
    ) -> Option<String> {
        self.hits
            .borrow()
            .iter()
            .find(|hit| {
                hit.member_id == member_id
                    && column >= hit.area.x
                    && column < hit.area.right()
                    && row >= hit.area.y
                    && row < hit.area.bottom()
            })
            .map(|hit| hit.key.clone())
    }
}

pub(in crate::board) fn capability_supported(operations: &[Value]) -> bool {
    let has = |name: &str| operations.iter().any(|op| op.as_str() == Some(name));
    has("keptReplies.list") && has("keptReplies.show") && has("keptReplies.remove")
}

pub(in crate::board) fn parse_list_items(document: &Value) -> Vec<KeptReplySummary> {
    document["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let key = row["key"].as_str()?.to_owned();
            let member_id = row["memberId"].as_str()?.to_owned();
            let at_ms = row["atMs"].as_u64().unwrap_or(0);
            let excerpt = row["excerpt"].as_str().unwrap_or_default().to_owned();
            Some(KeptReplySummary {
                key,
                member_id,
                source: Source::parse(row["source"].as_str()),
                at_ms,
                excerpt,
            })
        })
        .collect()
}

pub(in crate::board) fn parse_detail(document: &Value) -> Result<KeptReplyDetail, String> {
    let key = document["key"]
        .as_str()
        .ok_or_else(|| "Kept reply response missing key.".to_owned())?
        .to_owned();
    let member_id = document["memberId"].as_str().unwrap_or_default().to_owned();
    let at_ms = document["atMs"].as_u64().unwrap_or(0);
    let text = document["text"]
        .as_str()
        .ok_or_else(|| "Kept reply response missing text.".to_owned())?
        .to_owned();
    let truncated = document["truncated"].as_bool().unwrap_or(false);
    Ok(KeptReplyDetail {
        key,
        member_id,
        source: Source::parse(document["source"].as_str()),
        at_ms,
        text,
        truncated,
    })
}

pub(in crate::board) fn list(
    core: &Core,
    member_id: &str,
    limit: usize,
) -> Result<Vec<KeptReplySummary>, String> {
    let document = core
        .api(
            "keptReplies.list",
            json!({
                "memberId": member_id,
                "limit": limit.clamp(1, 64),
            }),
        )
        .map_err(|error| error.to_string())?;
    Ok(parse_list_items(&document))
}

pub(in crate::board) fn show(core: &Core, key: &str) -> Result<KeptReplyDetail, String> {
    let document = core
        .api("keptReplies.show", json!({ "key": key }))
        .map_err(|error| error.to_string())?;
    parse_detail(&document)
}

pub(in crate::board) fn remove(core: &Core, key: &str) -> Result<String, String> {
    let document = core
        .api("keptReplies.remove", json!({ "key": key }))
        .map_err(|error| error.to_string())?;
    if document["removed"].as_bool() == Some(true) {
        Ok(key.to_owned())
    } else {
        Err("Core did not confirm removing the kept reply.".to_owned())
    }
}

impl super::app::App {
    pub(in crate::board) fn keep_reply_capable(&self) -> bool {
        self.kept_replies.supported.unwrap_or(false)
    }

    pub(in crate::board) fn conversation_member_id(&self) -> Option<String> {
        let target = self.conversation_target()?;
        self.target_row(&target)?["id"].as_str().map(str::to_owned)
    }

    pub(in crate::board) fn composer_keep_reply_key(&self) -> Option<String> {
        let action = crate::action::Verb::Ui(crate::action::OpsUiAction::KeepReply);
        self.bindings()
            .into_iter()
            .find(|(_, bound)| bound.verb == action)
            .map(|(key, _)| super::view::footer::key_label(&key).to_owned())
    }

    pub(in crate::board) fn toggle_keep_reply(&mut self) -> super::app::Effect {
        let focused_talk = self
            .composer_projection()
            .is_some_and(|projection| projection.focused)
            && self.input.as_ref().is_some_and(|input| {
                matches!(input.compose, super::app::Compose::Talk { .. })
                    && super::composer::shell_prefix(input.text.as_str()).is_none()
            });
        if !focused_talk {
            return self
                .say("Keep reply is only available while composing a one-to-one Talk message.");
        }
        if !self.keep_reply_capable() {
            return self.say("Kept replies require a newer Core (keptReplies API unavailable).");
        }
        if let Some(input) = self.input.as_mut() {
            input.keep_reply = !input.keep_reply;
        }
        self.remember_draft();
        super::app::Effect::None
    }

    pub(in crate::board) fn kept_replies_key(
        &mut self,
        key: ratatui::crossterm::event::KeyEvent,
    ) -> Option<super::app::Effect> {
        use ratatui::crossterm::event::{KeyCode, KeyModifiers};
        if self.modal_open() || self.input.is_some() || self.menu.is_some() || self.is_searching() {
            return None;
        }
        if self.focused_pane() != Some(crate::config::Pane::Replies) {
            return None;
        }
        let member_id = self.conversation_member_id()?;
        if self.kept_replies.member_id.as_deref() != Some(member_id.as_str())
            || self.kept_replies.items.is_empty()
        {
            return None;
        }
        if !self.kept_replies.focused {
            if key.code == KeyCode::Up
                && key.modifiers.is_empty()
                && self.scrolls.offset(crate::config::Pane::Replies) == 0
                && self.kept_replies.focus()
            {
                return Some(super::app::Effect::None);
            }
            return None;
        }
        match (key.code, key.modifiers) {
            (KeyCode::Up, KeyModifiers::NONE) => {
                self.kept_replies.move_selection(-1);
                Some(super::app::Effect::None)
            }
            (KeyCode::Down, KeyModifiers::NONE) => {
                self.kept_replies.move_selection(1);
                Some(super::app::Effect::None)
            }
            (KeyCode::Esc, KeyModifiers::NONE) => {
                self.kept_replies.unfocus();
                Some(super::app::Effect::None)
            }
            (KeyCode::Enter, KeyModifiers::NONE) => {
                let item = self.kept_replies.selected_item()?;
                Some(super::app::Effect::Act(super::app::Request::KeptShow {
                    member_id,
                    key: item.key.clone(),
                }))
            }
            (KeyCode::Char('x'), KeyModifiers::NONE) => {
                let item = self.kept_replies.selected_item()?;
                Some(super::app::Effect::Act(super::app::Request::KeptRemove {
                    member_id,
                    key: item.key.clone(),
                }))
            }
            _ => None,
        }
    }

    pub(in crate::board) fn kept_replies_click(
        &mut self,
        column: u16,
        row: u16,
    ) -> Option<super::app::Effect> {
        let member_id = self.conversation_member_id()?;
        let in_pane = self
            .conversation
            .borrow()
            .pane
            .is_some_and(|pane| pane.contains((column, row).into()));
        if !in_pane {
            return None;
        }
        let key = self.kept_replies.hit_at(&member_id, column, row)?;
        self.kept_replies.focused = true;
        self.kept_replies.selected_key = Some(key.clone());
        Some(super::app::Effect::Act(super::app::Request::KeptShow {
            member_id,
            key,
        }))
    }

    pub(in crate::board) fn finished_kept_show(
        &mut self,
        member_id: &str,
        result: Result<KeptReplyDetail, String>,
    ) {
        if self.conversation_member_id().as_deref() != Some(member_id) {
            return;
        }
        match result {
            Ok(detail) => {
                let Some(target) = self.conversation_target() else {
                    return;
                };
                let from = self
                    .target_row(&target)
                    .and_then(|row| row["name"].as_str())
                    .unwrap_or("agent")
                    .to_owned();
                let body = if detail.truncated {
                    format!("{}\n\n[Truncated by Core retention]", detail.text)
                } else {
                    detail.text
                };
                let reply = super::row_detail::Reply {
                    key: None,
                    from,
                    age: crate::requests::age(crate::status::now_ms(), detail.at_ms),
                    body,
                    at_ms: Some(detail.at_ms),
                    acquired: true,
                    source: false,
                };
                self.row_details.reader = Some(super::row_detail::Reader::new(
                    super::row_detail::Target::Row(target),
                    Some(reply),
                ));
            }
            Err(error) => {
                self.set_notice(Some(error), true);
            }
        }
    }

    pub(in crate::board) fn finished_kept_remove(
        &mut self,
        member_id: &str,
        key: &str,
        result: Result<String, String>,
    ) {
        match result {
            Ok(_) => {
                if self.kept_replies.remove_confirmed(member_id, key) {
                    self.set_notice(Some("Kept reply removed.".into()), false);
                }
            }
            Err(error) => {
                self.set_notice(Some(error), true);
            }
        }
    }
}

#[cfg(test)]
pub(in crate::board) mod tests {
    use super::*;

    pub(in crate::board) const HOME_SCENES: &[&str] =
        &["kept-reply-draft", "kept-reply-list", "kept-reply-yield"];

    pub(in crate::board) fn home_scene(
        scene: &str,
        look: crate::look::Look,
        now_ms: u64,
    ) -> crate::board::app::App {
        let mut app = crate::board::app::workspace::tests::board();
        app.view.as_mut().unwrap().look = look;
        app.kept_replies.supported = Some(true);
        let member_id = app.conversation_member_id().unwrap();
        match scene {
            "kept-reply-draft" => {
                use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
                app.focus_composer();
                if let Some(input) = app.input.as_mut() {
                    input.text = "Can you confirm the cap?".into();
                    input.keep_reply = true;
                }
                let _ = app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
                app.finish_draft(true);
                if let Some(input) = app.input.as_mut() {
                    input.text = "Check the protocol decision.".into();
                    input.keep_reply = true;
                }
            }
            "kept-reply-list" | "kept-reply-yield" => {
                use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
                app.loading_since = None;
                app.selected_request = crate::board::refresh::SelectedRequest::Unmanaged;
                app.focus_composer();
                for msg in [
                    "Can you confirm the 64-entry cap?",
                    "Also check the 100-column layout.",
                ] {
                    if let Some(input) = app.input.as_mut() {
                        input.text = msg.into();
                    }
                    let _ = app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
                    app.finish_draft(true);
                }
                let _ = app.key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
                app.kept_replies.clear_for_switch(Some(member_id.clone()));
                app.kept_replies.publish(
                    &member_id,
                    vec![
                        KeptReplySummary {
                            key: "k2".into(),
                            member_id: member_id.clone(),
                            source: Source::Request,
                            at_ms: now_ms.saturating_sub(120_000),
                            excerpt: "Protocol decision: use 64-entry cap per person.".into(),
                        },
                        KeptReplySummary {
                            key: "k1".into(),
                            member_id: member_id.clone(),
                            source: Source::Passthrough,
                            at_ms: now_ms.saturating_sub(360_000),
                            excerpt: "Tests pass on +1.97.0 with zero warnings.".into(),
                        },
                    ],
                );
                app.focus = 1;
                app.kept_replies.focus();
            }
            other => panic!("unknown kept reply scene: {other}"),
        }
        app
    }

    fn summary(key: &str, at_ms: u64) -> KeptReplySummary {
        KeptReplySummary {
            key: key.into(),
            member_id: "m1".into(),
            source: Source::Request,
            at_ms,
            excerpt: format!("excerpt {key}"),
        }
    }

    #[test]
    fn reconcile_selection_tracks_key_not_former_row_index() {
        let mut state = KeptRepliesState::default();
        state.clear_for_switch(Some("m1".into()));
        state.publish("m1", vec![summary("k2", 200), summary("k1", 100)]);
        assert!(state.focus());
        assert_eq!(state.selected_key.as_deref(), Some("k2"));
        assert!(state.move_selection(1));
        assert_eq!(state.selected_key.as_deref(), Some("k1"));

        // A new item k3 arrives at index 0; selection must stay on k1 by key.
        state.publish(
            "m1",
            vec![summary("k3", 300), summary("k2", 200), summary("k1", 100)],
        );
        assert_eq!(state.selected_key.as_deref(), Some("k1"));

        // Removing k2 leaves k1 selected.
        assert!(state.remove_confirmed("m1", "k2"));
        assert_eq!(state.selected_key.as_deref(), Some("k1"));

        // Removing k1 selects the remaining item k3.
        assert!(state.remove_confirmed("m1", "k1"));
        assert_eq!(state.selected_key.as_deref(), Some("k3"));

        // Removing the last item unfocuses the kept list.
        assert!(state.remove_confirmed("m1", "k3"));
        assert!(!state.focused);
        assert_eq!(state.selected_key, None);
    }

    #[test]
    fn hit_at_fences_by_member_id_and_clipped_area() {
        let state = KeptRepliesState::default();
        state.hits.borrow_mut().push(RowHit {
            area: Rect::new(10, 5, 20, 1),
            member_id: "m1".into(),
            key: "k1".into(),
        });
        assert_eq!(state.hit_at("m1", 10, 5).as_deref(), Some("k1"));
        assert_eq!(state.hit_at("m1", 30, 5), None);
        assert_eq!(state.hit_at("m2", 15, 5), None);
    }

    #[test]
    fn named_action_parses_and_capability_gates_toggle_and_send() {
        assert_eq!(
            crate::action::OpsUiAction::parse("keep-reply"),
            Some(crate::action::OpsUiAction::KeepReply)
        );
        let mut app = crate::board::app::workspace::tests::board();
        assert_eq!(app.composer_keep_reply_key(), None);
        app.focus_composer();
        // Without Core capability, toggling explains the requirement and leaves keep_reply false.
        let _ = app.toggle_keep_reply();
        assert!(!app.input.as_ref().unwrap().keep_reply);
        assert!(
            app.notice
                .as_ref()
                .is_some_and(|n| n.contains("newer Core"))
        );

        // Enable capability, toggle on, then disable capability: sending must refuse unmarked send.
        app.kept_replies.supported = Some(true);
        let _ = app.toggle_keep_reply();
        assert!(app.input.as_ref().unwrap().keep_reply);
        app.kept_replies.supported = Some(false);
        app.input.as_mut().unwrap().text = "hello".into();
        let effect = app.key(ratatui::crossterm::event::KeyEvent::new(
            ratatui::crossterm::event::KeyCode::Enter,
            ratatui::crossterm::event::KeyModifiers::NONE,
        ));
        assert_eq!(effect, crate::board::app::Effect::None);
        assert!(app.input.as_ref().unwrap().keep_reply);
    }

    #[test]
    fn kept_replies_key_navigation_open_remove_and_escape() {
        use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        let mut app = crate::board::app::workspace::tests::board();
        let member_id = app.conversation_member_id().unwrap();
        app.kept_replies.clear_for_switch(Some(member_id.clone()));
        app.kept_replies
            .publish(&member_id, vec![summary("k2", 200), summary("k1", 100)]);
        // Ensure Replies pane is focused.
        app.focus = 1;
        app.scrolls.restore([(crate::config::Pane::Replies, 0)]);

        assert_eq!(
            app.kept_replies_key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE)),
            Some(crate::board::app::Effect::None)
        );
        assert!(app.kept_replies.focused);
        assert_eq!(app.kept_replies.selected_key.as_deref(), Some("k2"));

        assert_eq!(
            app.kept_replies_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
            Some(crate::board::app::Effect::None)
        );
        assert_eq!(app.kept_replies.selected_key.as_deref(), Some("k1"));

        assert_eq!(
            app.kept_replies_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            Some(crate::board::app::Effect::Act(
                crate::board::app::Request::KeptShow {
                    member_id: member_id.clone(),
                    key: "k1".into(),
                }
            ))
        );

        assert_eq!(
            app.kept_replies_key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE)),
            Some(crate::board::app::Effect::Act(
                crate::board::app::Request::KeptRemove {
                    member_id: member_id.clone(),
                    key: "k1".into(),
                }
            ))
        );

        // Failed remove keeps the item intact.
        app.finished_kept_remove(&member_id, "k1", Err("not found".into()));
        assert_eq!(app.kept_replies.items.len(), 2);

        // Confirmed remove drops only k1.
        app.finished_kept_remove(&member_id, "k1", Ok("k1".into()));
        assert_eq!(app.kept_replies.items.len(), 1);
        assert_eq!(app.kept_replies.selected_key.as_deref(), Some("k2"));

        // Esc unfocuses kept list.
        assert_eq!(
            app.kept_replies_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
            Some(crate::board::app::Effect::None)
        );
        assert!(!app.kept_replies.focused);
    }
}
