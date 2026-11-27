//! A transcript command opens the shared Run form for explicit confirmation.
use super::{
    commands, menu_area,
    popover::{LINE, chunks},
};
use crate::board::{
    app::{App, Choice, Effect, Menu, MenuEntry},
    workspace::OpsTarget,
};
use ratatui::layout::Rect;
use std::cell::RefCell;

impl App {
    pub(in crate::board) fn command_popover(
        &mut self,
        mention: &commands::Command,
        anchor: Rect,
    ) -> Effect {
        let command = mention.text.as_str();
        let identity = self.terminals_owner().map(str::to_owned);
        let target = identity
            .as_deref()
            .and_then(|id| self.member_link_target(id));
        let screen = self.member_links.borrow().screen;
        let lines: Vec<_> = mention
            .shown
            .split('\n')
            .flat_map(|line| chunks(line, LINE))
            .collect();
        let mut entries: Vec<_> = lines
            .into_iter()
            .map(|label| MenuEntry {
                chip: None,
                separator: false,
                key: String::new(),
                label,
                choice: Choice::Heading,
            })
            .collect();
        let header = entries.len();
        let choice = match target {
            Some(target) if tmt_pty_protocol::valid_command(command) => Choice::CommandForm {
                target,
                command: command.into(),
            },
            _ => Choice::Unavailable(
                "Run needs a member and one visible command line; copy it instead.".into(),
            ),
        };
        entries.push(MenuEntry {
            chip: None,
            separator: false,
            key: String::new(),
            label: "Run…".into(),
            choice,
        });
        entries.push(MenuEntry {
            chip: None,
            separator: false,
            key: "y".into(),
            label: "Copy command".into(),
            choice: Choice::CommandCopy(mention.clone()),
        });
        entries.push(MenuEntry {
            chip: None,
            separator: false,
            key: String::new(),
            label: "Show full".into(),
            choice: Choice::CommandShow {
                command: mention.clone(),
                anchor,
            },
        });
        let desired = u16::try_from(entries.len() + 4).unwrap_or(u16::MAX);
        if menu_area(screen, anchor, desired).is_none() {
            return self.say("Not enough room beside this command; resize to open its actions.");
        }
        self.menu = Some(Menu {
            link: None,
            prefill: String::new(),
            title: "Command".into(),
            entries,
            selected: header,
            anchor: Some(anchor),
            surface: RefCell::new(None),
        });
        Effect::None
    }

    pub(in crate::board) fn command_form(&mut self, target: &OpsTarget, command: &str) -> Effect {
        let OpsTarget::Member {
            identity_id,
            room_id,
        } = target
        else {
            return Effect::None;
        };
        if !self.member_link_valid(target) || !tmt_pty_protocol::valid_command(command) {
            return self.say("This member changed or is unavailable; reopen the command menu.");
        }
        let label = self
            .references
            .agents
            .get(identity_id)
            .map_or_else(|| identity_id.clone(), |agent| agent.name.clone());
        self.open_prefilled_run((identity_id.clone(), room_id.clone(), label), command, None)
    }
}

#[cfg(test)]
pub(super) fn capture_case(
    look: crate::look::Look,
    width: u16,
    height: u16,
    response: &str,
    open: bool,
) -> App {
    use crate::board::{
        app::workspace::tests::{MEMBER, board},
        inventory::Inventory,
    };
    use ratatui::{Terminal, backend::TestBackend};
    let mut app = board();
    app.references = Inventory::from_listed(&Ok(
        serde_json::json!({"identities":[{"id":MEMBER,"name":"worker","canonicalName":"worker"}]}),
    ));
    {
        let view = app.view.as_mut().unwrap();
        view.look = look;
        view.home.as_mut().unwrap().workspace.squad_looks.clear();
        view.replies = vec![
            serde_json::json!({"recipientId":MEMBER,"requestId":"command-scene","response":response}),
        ];
    }
    app.focus = 1;
    if !open {
        return app;
    }
    let draw = |app: &App| {
        Terminal::new(TestBackend::new(width, height))
            .unwrap()
            .draw(|frame| crate::board::view::render(frame, app))
            .unwrap();
    };
    draw(&app);
    let hit = app
        .member_links
        .borrow()
        .hits
        .iter()
        .find(|hit| matches!(hit.target, super::Target::Command(_)))
        .cloned()
        .expect("the command is painted");
    app.open_member_link(hit);
    draw(&app);
    app
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{
        app::{
            Request,
            workspace::tests::{MEMBER, board},
        },
        inventory::Inventory,
        member_links::Target,
    };
    use ratatui::{
        Terminal,
        backend::TestBackend,
        crossterm::event::{KeyCode, KeyEvent, KeyModifiers},
    };

    fn reader(response: &str) -> App {
        let mut app = board();
        app.references = Inventory::from_listed(&Ok(
            serde_json::json!({"identities":[{"id":MEMBER,"name":"worker","canonicalName":"worker"}]}),
        ));
        app.view.as_mut().unwrap().replies = vec![
            serde_json::json!({"recipientId":MEMBER,"requestId":"command","response":response}),
        ];
        app.focus = 1;
        draw(&app, 120, 40);
        app
    }

    fn draw(app: &App, width: u16, height: u16) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal
            .draw(|frame| crate::board::view::render(frame, app))
            .unwrap();
        terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect()
    }

    fn marked_fixture(shown: &str) -> commands::Command {
        commands::Command {
            shown: shown.into(),
            text: shown.strip_prefix("! ").unwrap().into(),
        }
    }

    #[test]
    fn transcript_run_opens_the_prefilled_form_without_sending_pty_input() {
        use crate::board::standalone::Task as RunTask;

        let command = "printf '%s' 'one quoted value'";
        let mut app = reader(&format!("Please run `! {command}`."));
        let press = |app: &mut App, code| app.key(KeyEvent::new(code, KeyModifiers::NONE));
        press(&mut app, KeyCode::Right);
        press(&mut app, KeyCode::Enter);
        let labels: Vec<_> = app
            .menu
            .as_ref()
            .expect("the command menu opens")
            .entries
            .iter()
            .filter(|entry| entry.label.starts_with("Run"))
            .map(|entry| entry.label.as_str())
            .collect();
        assert_eq!(labels, ["Run…"]);

        assert!(matches!(
            press(&mut app, KeyCode::Enter),
            Effect::Standalone(RunTask::Target(_, ref member)) if member == MEMBER
        ));
        assert!(app.terminals.offer(&[], None, 0).is_none());
        assert!(app.standalone.shown());
        let screen = draw(&app, 120, 40);
        assert!(screen.contains("Run command"));
        assert!(screen.contains(command));
    }

    #[test]
    fn copy_and_show_full_use_the_exact_command() {
        let mut app = reader("`! printf '%s' 'a b'`");
        let command = "printf '%s' 'a b'";
        let anchor = Rect::new(4, 5, 8, 1);
        app.command_popover(&marked_fixture("! printf '%s' 'a b'"), anchor);
        let choice = |label: &str| {
            app.menu
                .as_ref()
                .unwrap()
                .entries
                .iter()
                .find(|entry| entry.label == label)
                .unwrap()
                .choice
                .clone()
        };
        let copy = choice("Copy command");
        let show = choice("Show full");
        assert!(matches!(
            app.choose(copy),
            Effect::Act(Request::Copy { text, .. }) if text == command
        ));
        assert_eq!(app.choose(show), Effect::None);
        assert_eq!(app.menu.as_ref().unwrap().title, "Full command");
        let entry = app.menu.as_ref().unwrap().entries[0].choice.clone();
        assert!(matches!(
            app.choose(entry),
            Effect::Act(Request::Copy { text, .. }) if text == command
        ));
    }

    #[test]
    fn normalized_message_bytes_never_become_runnable_command_targets() {
        let app = reader("`! printf clean\u{1b}[31m`");
        assert!(
            app.member_links
                .borrow()
                .hits
                .iter()
                .all(|hit| !matches!(hit.target, Target::Command(_)))
        );
    }
}
