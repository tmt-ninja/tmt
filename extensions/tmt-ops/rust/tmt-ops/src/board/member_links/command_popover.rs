//! Human-confirmed commands use the existing anchored link menu and terminal task lane.
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
        let mut add_run = |label: String, terminal: Option<String>, available: bool| {
            let choice = target.as_ref().filter(|_| available).map_or_else(
                || {
                    Choice::Unavailable(
                        "This terminal is unavailable or busy; nothing was submitted.".into(),
                    )
                },
                |target| Choice::CommandRun {
                    target: target.clone(),
                    terminal,
                    command: command.into(),
                    screen,
                },
            );
            entries.push(MenuEntry {
                chip: None,
                separator: false,
                key: String::new(),
                label,
                choice,
            });
        };
        if let Some(identity) = &identity {
            let name = self
                .references
                .agents
                .get(identity)
                .map_or(identity.as_str(), |agent| agent.name.as_str());
            for row in self.terminals.rows(identity) {
                add_run(
                    format!("Run in {} · {name}", row.title()),
                    Some(row.id.clone()),
                    !row.ended && !row.busy,
                );
            }
        }
        add_run(
            "Run in a new terminal".into(),
            None,
            identity.as_deref().is_some_and(|id| self.bound_member(id)),
        );
        entries.push(MenuEntry {
            chip: None,
            separator: false,
            key: "y".into(),
            label: "Copy command".into(),
            choice: Choice::LinkCopy(command.into()),
        });
        let desired = u16::try_from(entries.len() + 4).unwrap_or(u16::MAX);
        let Some(area) = menu_area(screen, anchor, desired) else {
            return self.say("Not enough room beside this command; resize to open its actions.");
        };
        // A Run entry is confirmation only while every byte of the command is shown at once.
        // Scrolling to an action must never hide part of what it will submit.
        if area.width < 48 || area.height < desired || !tmt_pty_protocol::valid_command(command) {
            for entry in entries.iter_mut().skip(header) {
                if matches!(entry.choice, Choice::CommandRun { .. }) {
                    entry.choice = Choice::Unavailable("Run unavailable unless the whole single-line command is shown; copy it instead.".into());
                }
            }
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

    pub(in crate::board) fn command_run(
        &mut self,
        target: &OpsTarget,
        terminal: Option<&str>,
        command: &str,
        screen: Rect,
    ) -> Effect {
        if screen != self.member_links.borrow().screen {
            return self
                .say("The command menu no longer fits; reopen it to confirm the whole command.");
        }
        let OpsTarget::Member { identity_id, .. } = target else {
            return Effect::None;
        };
        if !self.member_link_valid(target)
            || !self.bound_member(identity_id)
            || !tmt_pty_protocol::valid_command(command)
        {
            return self.say("This member changed or is unavailable; reopen the command menu.");
        }
        if let Some(terminal) = terminal
            && !self
                .terminals
                .row(identity_id, terminal)
                .is_some_and(|row| !row.ended && !row.busy)
        {
            return self.say("This terminal changed or is busy; nothing was submitted.");
        }
        self.terminals.run(identity_id, terminal, command);
        Effect::None
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
        member_terminals::{Completed, List, Listed},
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
    app.terminals.finished(
        Completed::Listed(vec![(
            MEMBER.into(),
            List::Terminals(vec![
                Listed {
                    id: format!("term_{}", "1".repeat(32)),
                    socket: "/tmp/oracle-inert-terminal.sock".into(),
                    busy: false,
                    created_ms: 1,
                    shell: Some("sh".into()),
                    program: None,
                },
                Listed {
                    id: format!("term_{}", "2".repeat(32)),
                    socket: "/tmp/oracle-inert-busy.sock".into(),
                    busy: true,
                    created_ms: 2,
                    shell: Some("sh".into()),
                    program: Some("build".into()),
                },
            ]),
        )]),
        0,
    );
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
        member_terminals::Task,
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

        assert_eq!(
            press(&mut app, KeyCode::Enter),
            Effect::Standalone(RunTask::Target(MEMBER.into()))
        );
        assert!(app.terminals.offer(&[], None, 0).is_none());
        assert!(app.standalone.shown());
        let screen = draw(&app, 120, 40);
        assert!(screen.contains("Run command"));
        assert!(screen.contains(command));
    }

    #[test]
    fn selecting_and_opening_command_mentions_is_inert_then_run_queues_the_exact_command() {
        let mut app = reader("Please run `! printf '%s' 'one quoted value'` then `! pwd`.");
        let hits: Vec<_> = app
            .member_links
            .borrow()
            .hits
            .iter()
            .filter(|hit| matches!(hit.target, Target::Command(_)))
            .cloned()
            .collect();
        assert_eq!(hits.len(), 2);
        assert!(app.terminals.offer(&[], None, 0).is_none());
        app.key(KeyEvent::new(KeyCode::Right, KeyModifiers::NONE));
        assert!(
            matches!(&app.member_links.borrow().focused.as_ref().unwrap().target, Target::Command(mention) if mention.shown == "! printf '%s' 'one quoted value'")
        );
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        let menu = app.menu.as_ref().expect("the shared menu opens");
        assert_eq!(menu.title, "Command");
        assert_eq!(menu.entries[0].label, "! printf '%s' 'one quoted value'");
        assert!(app.terminals.offer(&[], None, 0).is_none());
        assert!(draw(&app, 120, 40).contains("Run in a new terminal"));
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(
            app.terminals.offer(&[], None, 0),
            Some(Task::Run {
                identity: MEMBER.into(),
                terminal: None,
                command: "printf '%s' 'one quoted value'".into()
            })
        );
    }

    #[test]
    fn copy_drops_only_the_marker_and_run_cannot_hide_text_or_survive_resize() {
        let mut app = reader("`! printf '%s' 'a b'`");
        let anchor = Rect::new(4, 5, 8, 1);
        app.command_popover(&marked_fixture("! printf '%s' 'a b'"), anchor);
        let run = app
            .menu
            .as_ref()
            .unwrap()
            .entries
            .iter()
            .find_map(|entry| {
                matches!(entry.choice, Choice::CommandRun { .. }).then(|| entry.choice.clone())
            })
            .unwrap();
        let copy = app
            .menu
            .as_ref()
            .unwrap()
            .entries
            .iter()
            .find(|entry| entry.label == "Copy command")
            .unwrap()
            .choice
            .clone();
        assert!(
            matches!(app.choose(copy), Effect::Act(Request::Copy { text, .. }) if text == "printf '%s' 'a b'")
        );
        app.member_links
            .borrow_mut()
            .begin_frame(Rect::new(0, 0, 80, 24));
        app.choose(run);
        assert!(app.terminals.offer(&[], None, 0).is_none());
        let full = format!("! printf '%s' '{}'", "x".repeat(60));
        app.member_links
            .borrow_mut()
            .begin_frame(Rect::new(0, 0, 120, 40));
        app.command_popover(&marked_fixture(&full), anchor);
        let menu = app.menu.as_ref().unwrap();
        let header: Vec<_> = menu
            .entries
            .iter()
            .filter(|entry| matches!(entry.choice, Choice::Heading))
            .map(|entry| entry.label.clone())
            .collect();
        assert!(header.len() > 1);
        assert_eq!(header.join(""), full);
        assert!(
            menu.entries
                .iter()
                .any(|entry| matches!(entry.choice, Choice::CommandRun { .. }))
        );
        let painted = draw(&app, 120, 40);
        assert!(
            header.iter().all(|line| painted.contains(line)),
            "the complete confirmation must be painted"
        );
        for (command, screen) in [
            ("! echo first\necho second".into(), Rect::new(0, 0, 120, 40)),
            (format!("! {}", "x".repeat(2000)), Rect::new(0, 0, 120, 40)),
            ("! pwd".into(), Rect::new(0, 0, 40, 20)),
        ] {
            app.member_links.borrow_mut().begin_frame(screen);
            app.command_popover(&marked_fixture(&command), anchor);
            assert!(
                !app.menu
                    .as_ref()
                    .unwrap()
                    .entries
                    .iter()
                    .any(|entry| matches!(entry.choice, Choice::CommandRun { .. })),
                "{command:?}"
            );
            assert!(
                app.menu
                    .as_ref()
                    .unwrap()
                    .entries
                    .iter()
                    .any(|entry| entry.label == "Copy command")
            );
        }
        assert!(app.terminals.offer(&[], None, 0).is_none());
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
