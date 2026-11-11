//! Changing a member's digest from the board. A source's `choose` label action
//! says what may be chosen and which argv applies it. This module decides who may
//! change it (the recorded user or that squad's lead, as for `tmt ops digest`) and
//! applies the chosen value. Both steps run on the lane, never on the board thread.
use super::{
    app::{App, Choice, Compose, Effect, Hint, Menu, MenuEntry, Request, RowTarget},
    notes::sanitize,
    workspace::OpsTarget,
};
use crate::{
    core::Core,
    digest_command::admission,
    labels::Choose,
    management::{self, ManagementActor},
    squad::Squad,
};

/// A request to change one member's digest, before anyone has checked access.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ask {
    pub squad: String,
    pub member: String,
    pub choose: Choose,
}

/// Access granted to `actor`: what the dropdown offers, and who applies it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Granted {
    pub ask: Ask,
    pub actor: ManagementActor,
}

/// One chosen value, ready to apply.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Set {
    pub actor: ManagementActor,
    pub squad: String,
    pub member: String,
    pub argv: Vec<String>,
    /// What the user chose, as shown back to them.
    pub shown: String,
}

impl Granted {
    /// The change that applies `value`, shown as `shown`; `None` when the value
    /// cannot be one argument.
    pub fn set(&self, value: &str, shown: &str) -> Option<Set> {
        Some(Set {
            actor: self.actor.clone(),
            squad: self.ask.squad.clone(),
            member: self.ask.member.clone(),
            argv: self.ask.choose.argv(value).ok()?,
            shown: sanitize(shown),
        })
    }
}

/// Checks that the person at the board may change this member's digest.
pub fn grant(core: &Core, ask: Ask) -> Result<Granted, String> {
    let squad = Squad::resolve(core, Some(&ask.squad)).map_err(|error| error.message)?;
    let actor = management::actor(core, None, &management::DIGEST)
        .map_err(admission)
        .map_err(|error| error.message)?;
    management::admit(core, &squad, &actor, &management::DIGEST)
        .map_err(admission)
        .map_err(|error| error.message)?;
    Ok(Granted { ask, actor })
}

/// Turns Digest on or off for everyone. That reaches every member, so only the
/// recorded user may, not a squad lead.
pub fn switch(core: &Core, on: bool) -> Result<String, String> {
    let actor = management::actor(core, None, &management::DIGEST)
        .map_err(admission)
        .map_err(|error| error.message)?;
    let user = crate::me::current(core)
        .map_err(|error| error.message)?
        .is_some_and(|user| user.id == actor.id);
    if !user {
        return Err("Only the recorded user can turn Digest on or off for everyone.".into());
    }
    let value = if on { "on" } else { "off" };
    match core.succeeds(&["digest".into(), "global".into(), value.into()]) {
        Ok(true) if on => Ok("Digest is on.".into()),
        Ok(true) => Ok("Digest is off: messages are sent one by one.".into()),
        Ok(false) => Err(format!("Digest was not turned {value}.")),
        Err(error) => Err(format!(
            "{} Digest may or may not be {value}.",
            error.message
        )),
    }
}

/// Applies a change after checking access again: the squad's lead may have
/// changed since the dropdown opened. A refused or failed change says so and is
/// never repeated; a lost answer says the outcome is unknown.
pub fn apply(core: &Core, set: Set) -> Result<String, String> {
    let squad = Squad::resolve(core, Some(&set.squad)).map_err(|error| error.message)?;
    management::admit(core, &squad, &set.actor, &management::DIGEST)
        .map_err(admission)
        .map_err(|error| error.message)?;
    match core.succeeds(&set.argv) {
        Ok(true) => Ok(format!("Digest for {}: {}.", set.member, set.shown)),
        Ok(false) => Err(format!(
            "Digest for {} was not changed: {} was not accepted.",
            set.member, set.shown
        )),
        Err(error) => Err(format!(
            "{} Digest for {} may or may not have changed.",
            error.message, set.member
        )),
    }
}

/// One unsent edit, frozen to the row whose access the lane checked.
type ModeOffer = (String, String, Option<(u64, u64)>);

fn choice_entries(granted: &Granted) -> (Vec<MenuEntry>, usize) {
    let choose = &granted.ask.choose;
    let mut entries: Vec<_> = choose
        .options
        .iter()
        .filter_map(|offer| {
            let current = if offer.value == choose.current {
                "  (current)"
            } else {
                ""
            };
            Some(MenuEntry {
                key: String::new(),
                label: format!("{}{current}", sanitize(&offer.label)),
                choice: Choice::Digest(granted.set(&offer.value, &offer.label)?),
            })
        })
        .collect();
    let selected = choose
        .options
        .iter()
        .position(|offer| offer.value == choose.current)
        .unwrap_or_default();
    entries.push(MenuEntry {
        key: String::new(),
        label: "Custom…".into(),
        choice: Choice::DigestCustom(Box::new(granted.clone())),
    });
    (entries, selected)
}

#[derive(Clone)]
pub(in crate::board) struct Inline {
    pub target: OpsTarget,
    pub granted: Option<Granted>,
    pub field: usize,
    pub mode: usize,
    pub caps: Option<(u64, u64)>,
    pub visible: std::cell::Cell<bool>,
}
impl Inline {
    pub fn lines(&self) -> Vec<String> {
        if self.granted.is_none() {
            return vec!["Checking Digest access… · Esc cancel".into()];
        }
        let modes = ["Auto", "Interval", "Off", "Use default"];
        let mode = modes
            .iter()
            .enumerate()
            .map(|(i, label)| {
                if i == self.mode {
                    format!("[{label}]")
                } else {
                    label.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        let mut lines = vec![format!(
            "{} mode {mode}",
            if self.field == 0 { "▸" } else { " " }
        )];
        if self.mode == 0
            && let Some((wait, count)) = self.caps
        {
            let hold = format!(
                "max hold {} ▾",
                super::digest_dashboard::model::human_duration(wait)
            );
            let messages = format!("max messages {count} ▾");
            lines.push(format!(
                "{} {} · {}",
                if self.field > 0 { "▸" } else { " " },
                if self.field == 1 {
                    format!("[{hold}]")
                } else {
                    hold
                },
                if self.field == 2 {
                    format!("[{messages}]")
                } else {
                    messages
                }
            ));
        }
        lines
    }
}

impl App {
    /// Starts changing the digest of the row at `index`: Core is asked, on the
    /// lane, whether the person at the board may; the dropdown opens once it says so.
    pub(super) fn digest_row(&mut self, index: usize) -> Effect {
        if self.shell.tab == super::shell::OpsTab::Digest {
            let Some(RowTarget::Workspace(target)) = self.row_target(index) else {
                return self.say("Workspace Digest switches are in ? settings.");
            };
            let OpsTarget::Member { identity_id, .. } = &target else {
                return self.say("Select an agent to edit Digest.");
            };
            return match self.digest_ask(index) {
                Ok(ask) => {
                    let member = self
                        .labels
                        .digest()
                        .and_then(|(status, _)| status.members.get(identity_id));
                    self.digest_inline = Some(Inline {
                        target,
                        granted: None,
                        field: 0,
                        mode: member.map_or(0, |m| match m.mode {
                            crate::labels::digest::Mode::Auto => 0,
                            crate::labels::digest::Mode::Interval => 1,
                            crate::labels::digest::Mode::Off => 2,
                        }),
                        caps: member.and_then(|m| m.auto_caps),
                        visible: std::cell::Cell::new(false),
                    });
                    Effect::Act(Request::DigestOpen(ask))
                }
                Err(reason) => self.say(reason),
            };
        }
        // The `all` row stands for everybody: its digest is the one global switch.
        if matches!(
            self.row_target(index),
            Some(RowTarget::Workspace(OpsTarget::DigestAll))
        ) {
            return self.digest_switch();
        }
        match self.digest_ask(index) {
            Ok(ask) => Effect::Act(Request::DigestOpen(ask)),
            Err(reason) => self.say(reason),
        }
    }

    fn digest_ask(&self, index: usize) -> Result<Ask, String> {
        let target = self.row_target(index).ok_or("No row is selected.")?;
        let row = self.target_row(&target).ok_or("No row is selected.")?;
        let squad = match &target {
            RowTarget::Workspace(_) => {
                self.target_squad(&target)
                    .filter(|name| !name.is_empty())
                    .ok_or("Choose a squad membership before managing Digest.")?
            }
            RowTarget::Member { squad, .. } | RowTarget::Lead { squad, .. } => squad.clone(),
        };
        let (Some(_), Some(member)) = (row["id"].as_str(), row["name"].as_str()) else {
            return Err("This row is not a member.".into());
        };
        let choose = self
            .digest_choice(row)
            .ok_or_else(|| format!("{member} has no digest choices to change."))?;
        Ok(Ask {
            squad,
            member: member.to_owned(),
            choose,
        })
    }

    /// Flips the supplier's one switch, as it reads now: on becomes off and off becomes on.
    pub(super) fn digest_switch(&mut self) -> Effect {
        match self
            .labels
            .digest()
            .and_then(|(status, _)| status.global.as_ref())
        {
            Some(global) => Effect::Act(Request::DigestSwitch(!global.enabled)),
            None => self.say("Digest has not reported its switch yet."),
        }
    }

    /// The choice the member's mode chip offers, when a source supplied one.
    pub(super) fn digest_choice(&self, row: &serde_json::Value) -> Option<Choose> {
        self.labels
            .of(row["id"].as_str()?)
            .find_map(|(_, label)| label.action.clone())
    }

    /// The dropdown: the source's choices in its order, the current one marked,
    /// then the board's own `Custom…`.
    pub(super) fn open_digest(&mut self, granted: Granted) {
        // The answer arrives off the board thread; whatever the user opened since
        // keeps the screen.
        if self.modal_open() || self.input.is_some() {
            return;
        }
        if self.shell.tab == super::shell::OpsTab::Digest {
            if let Some(inline) = self
                .digest_inline
                .as_mut()
                .filter(|inline| Some(&inline.target) == self.workspace.selected.as_ref())
            {
                inline.granted = Some(granted);
            }
            return;
        }
        let (entries, selected) = choice_entries(&granted);
        let title = format!("{} digest", granted.ask.member);
        self.menu = Some(Menu {
            link: None,
            prefill: String::new(),
            title,
            entries,
            selected,
            anchor: None,
            surface: Default::default(),
        });
    }

    /// The input behind `Custom…`; the hint says what it takes.
    pub(super) fn digest_custom(&mut self, granted: Granted) -> Effect {
        let (prompt, squad) = (
            format!("{} digest · Enter sets, Esc cancels", granted.ask.member),
            granted.ask.squad.clone(),
        );
        let effect = self.ask(prompt, Compose::Digest(Box::new(granted)), squad);
        if let Some(input) = &mut self.input {
            input.hint = Some(Hint {
                text: "A duration such as 20s, 10m or 1h; empty goes back to the default.".into(),
                error: false,
            });
        }
        effect
    }

    /// Empty text clears the member's own value, which is the source's `default`.
    pub(super) fn digest_submit(&mut self, granted: Granted, text: &str) -> Effect {
        let text = text.trim();
        let (value, shown) = if text.is_empty() {
            ("default", "default")
        } else {
            (text, text)
        };
        match granted.set(value, shown) {
            Some(set) => Effect::Act(Request::Digest(set)),
            None => self.say("That is not a value digest can take; nothing changed."),
        }
    }
}

#[cfg(test)]
mod tests;

impl App {
    pub(super) fn digest_inline_key(
        &mut self,
        key: ratatui::crossterm::event::KeyEvent,
    ) -> Option<Effect> {
        use ratatui::crossterm::event::KeyCode;
        if self.shell.tab != super::shell::OpsTab::Digest {
            return None;
        }
        let inline = self.digest_inline.as_mut()?;
        if Some(&inline.target) != self.workspace.selected.as_ref() {
            self.digest_inline = None;
            return Some(Effect::None);
        }
        if key.code == KeyCode::Esc {
            self.digest_inline = None;
            return Some(Effect::None);
        }
        if inline.granted.is_none() {
            return Some(Effect::None);
        }
        match key.code {
            KeyCode::Up => inline.field = inline.field.saturating_sub(1),
            KeyCode::Down => {
                inline.field =
                    (inline.field + 1).min(if inline.mode == 0 && inline.caps.is_some() {
                        2
                    } else {
                        0
                    })
            }
            KeyCode::Left if inline.field == 0 => inline.mode = inline.mode.saturating_sub(1),
            KeyCode::Right if inline.field == 0 => inline.mode = (inline.mode + 1).min(3),
            KeyCode::Enter => {
                if !inline.visible.get() {
                    return Some(Effect::None);
                }
                let inline = inline.clone();
                let granted = inline.granted.as_ref().unwrap();
                let set = |value: &str, shown: &str, caps: Option<(u64, u64)>| {
                    let mut set = granted.set(value, shown)?;
                    if let Some((wait, count)) = caps {
                        if set.argv.first().is_none_or(|command| command != "digest") {
                            return None;
                        }
                        set.argv.extend([
                            "--max-wait".into(),
                            format!("{wait}ms"),
                            "--max-count".into(),
                            count.to_string(),
                        ]);
                    }
                    Some(set)
                };
                if inline.field == 0 && inline.mode != 1 {
                    let (value, shown) = match inline.mode {
                        0 => ("auto", "Auto"),
                        2 => ("off", "Off"),
                        _ => ("default", "Use default"),
                    };
                    let caps = if inline.mode == 0 { inline.caps } else { None };
                    self.digest_inline = None;
                    return Some(
                        set(value, shown, caps)
                            .map_or(Effect::None, |set| Effect::Act(Request::Digest(set))),
                    );
                }
                if inline.field == 0 {
                    let (entries, selected) = choice_entries(granted);
                    self.menu = Some(Menu {
                        link: None,
                        prefill: String::new(),
                        title: "Interval".into(),
                        entries,
                        selected,
                        anchor: None,
                        surface: Default::default(),
                    });
                    if let Some(inline) = &self.digest_inline {
                        inline.visible.set(false);
                    }
                    return Some(Effect::None);
                }
                let offers: Vec<ModeOffer> = if let Some((wait, count)) = inline.caps {
                    if inline.field == 1 {
                        [
                            30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000,
                        ]
                        .into_iter()
                        .map(|n| {
                            (
                                "auto".into(),
                                format!("Max hold {}s", n / 1000),
                                Some((n, count)),
                            )
                        })
                        .collect()
                    } else {
                        [1, 5, 10, 20, 50, 100]
                            .into_iter()
                            .map(|n| ("auto".into(), format!("Max messages {n}"), Some((wait, n))))
                            .collect()
                    }
                } else {
                    Vec::new()
                };
                let entries = offers
                    .into_iter()
                    .filter_map(|(value, shown, caps)| {
                        Some(MenuEntry {
                            key: String::new(),
                            label: shown.clone(),
                            choice: Choice::Digest(set(&value, &shown, caps)?),
                        })
                    })
                    .collect();
                self.menu = Some(Menu {
                    link: None,
                    prefill: String::new(),
                    title: if inline.field == 0 {
                        "Interval"
                    } else if inline.field == 1 {
                        "Max hold"
                    } else {
                        "Max messages"
                    }
                    .into(),
                    entries,
                    selected: 0,
                    anchor: None,
                    surface: Default::default(),
                });
            }
            _ => {}
        }
        if let Some(inline) = &self.digest_inline {
            inline.visible.set(false);
        }
        Some(Effect::None)
    }
    pub(in crate::board) fn digest_bars_menu(&mut self) -> Effect {
        let count = if self.digest_window() == crate::config::DigestWindow::Day {
            24
        } else if self.digest_window() == crate::config::DigestWindow::Week {
            7
        } else {
            30
        };
        let unit = if count == 24 { "h" } else { "d" };
        let entries = (1..=count)
            .filter(|n| count % n == 0)
            .map(|n| MenuEntry {
                key: String::new(),
                label: format!("{n}{unit} per bar"),
                choice: Choice::DigestBars(n),
            })
            .collect();
        self.menu = Some(Menu {
            link: None,
            prefill: String::new(),
            title: "Per bar".into(),
            entries,
            selected: 0,
            anchor: None,
            surface: Default::default(),
        });
        Effect::None
    }
}
