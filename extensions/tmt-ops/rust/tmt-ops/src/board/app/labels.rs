//! Member label menu and editor state. Configuration writes stay on the action lane.
use super::*;
use crate::board::workspace::OpsTarget;
use crate::config::OpsPreferences;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::board) enum LabelField {
    Glyph,
    Name,
    Color,
}

struct LabelDraft {
    expected: std::sync::Arc<crate::config::WorkspaceLabels>,
    original: Option<crate::config::BoardLabel>,
    value: crate::config::BoardLabel,
}

#[derive(Default)]
pub(in crate::board) struct LabelState {
    draft: Option<LabelDraft>,
    pub(super) field: Option<LabelField>,
    pub(super) save_pending: bool,
}

impl App {
    pub(super) fn open_member_label(&mut self) -> Effect {
        let Some(OpsTarget::Member { identity_id, .. }) = self.workspace_selected_member() else {
            return self.say("Select an agent to label.");
        };
        let member = identity_id.clone();
        let Some(snapshot) = self.workspace_snapshot() else {
            return Effect::None;
        };
        let title = snapshot.roster.members.get(&member).map_or_else(
            || "Label".to_owned(),
            |value| format!("Label · {}", crate::board::notes::single_line(&value.name)),
        );
        let labels = std::sync::Arc::new(snapshot.preferences.labels.clone());
        let mut entries = Vec::new();
        for (index, label) in labels.definitions.iter().enumerate() {
            entries.push(MenuEntry {
                chip: Some(MenuChip {
                    glyph: label.glyph.clone(),
                    role: crate::look::role(&label.color).expect("validated label role"),
                }),
                separator: false,
                key: if index < 9 {
                    (index + 1).to_string()
                } else {
                    String::new()
                },
                label: label.name.clone(),
                choice: Choice::MemberLabel {
                    expected: labels.clone(),
                    member: member.clone(),
                    label: Some(label.id.clone()),
                },
            });
        }
        entries.push(MenuEntry {
            chip: None,
            separator: false,
            key: "0".into(),
            label: "clear".into(),
            choice: Choice::MemberLabel {
                expected: labels,
                member,
                label: None,
            },
        });
        entries.push(MenuEntry {
            chip: None,
            separator: true,
            key: String::new(),
            label: String::new(),
            choice: Choice::Rule,
        });
        entries.push(MenuEntry {
            chip: None,
            separator: false,
            key: "e".into(),
            label: "Edit labels…".into(),
            choice: Choice::EditLabels,
        });
        self.menu = Some(Menu {
            link: None,
            prefill: String::new(),
            title,
            entries,
            selected: 0,
            anchor: None,
            surface: Default::default(),
        });
        Effect::None
    }

    pub(super) fn save_member_label(
        &mut self,
        expected: std::sync::Arc<crate::config::WorkspaceLabels>,
        member: String,
        label: Option<String>,
    ) -> Effect {
        if !matches!(self.workspace_selected_member(), Some(OpsTarget::Member { identity_id, .. }) if identity_id == &member)
        {
            return self.say("Select an agent to label.");
        }
        Effect::Act(Request::MemberLabel {
            expected,
            member,
            label,
        })
    }

    pub(super) fn open_label_editor(&mut self) -> Effect {
        if self.label_editor.save_pending {
            return self.say("A label save is already in progress.");
        }
        if self.label_editor.draft.is_some() {
            return self.label_draft_menu();
        }
        let Some(snapshot) = self.workspace_snapshot() else {
            return Effect::None;
        };
        let mut entries: Vec<_> = snapshot
            .preferences
            .labels
            .definitions
            .iter()
            .map(|label| MenuEntry {
                chip: Some(MenuChip {
                    glyph: label.glyph.clone(),
                    role: crate::look::role(&label.color).expect("validated label role"),
                }),
                separator: false,
                key: String::new(),
                label: label.name.clone(),
                choice: Choice::LabelDefinition(label.id.clone()),
            })
            .collect();
        entries.push(MenuEntry {
            chip: None,
            separator: false,
            key: String::new(),
            label: "New label…".into(),
            choice: Choice::LabelNew,
        });
        self.menu = Some(Menu {
            link: None,
            prefill: String::new(),
            title: "Edit labels".into(),
            entries,
            selected: 0,
            anchor: None,
            surface: Default::default(),
        });
        Effect::None
    }

    pub(super) fn open_label_definition(&mut self, id: &str) -> Effect {
        if self.label_editor.save_pending {
            return self.say("A label save is already in progress.");
        }
        let Some(snapshot) = self.workspace_snapshot() else {
            return Effect::None;
        };
        let Some(value) = snapshot
            .preferences
            .labels
            .definitions
            .iter()
            .find(|label| label.id == id)
            .cloned()
        else {
            return self.say("Label no longer exists.");
        };
        self.label_editor.draft = Some(LabelDraft {
            expected: std::sync::Arc::new(snapshot.preferences.labels.clone()),
            original: Some(value.clone()),
            value,
        });
        self.label_draft_menu()
    }

    pub(super) fn new_label_definition(&mut self) -> Effect {
        if self.label_editor.save_pending {
            return self.say("A label save is already in progress.");
        }
        let Some(snapshot) = self.workspace_snapshot() else {
            return Effect::None;
        };
        if snapshot.preferences.labels.definitions.len() >= 32 {
            return self.say("A maximum of 32 labels is allowed.");
        }
        let expected = std::sync::Arc::new(snapshot.preferences.labels.clone());
        // At most 31 definitions exist here, so one of these 32 IDs is free.
        // Allocation stays in the retained model; Config's CAS fences another editor.
        let id = (1..=32)
            .map(|number| format!("label-{number}"))
            .find(|id| expected.definitions.iter().all(|label| &label.id != id))
            .expect("fewer than 32 label definitions");
        self.label_editor.draft = Some(LabelDraft {
            expected,
            original: None,
            value: crate::config::BoardLabel {
                id,
                glyph: "?".into(),
                color: "muted".into(),
                name: String::new(),
            },
        });
        self.label_draft_menu()
    }

    pub(super) fn label_draft_menu(&mut self) -> Effect {
        let Some(draft) = &self.label_editor.draft else {
            return self.open_label_editor();
        };
        let safe = |value: &str| crate::board::notes::single_line(value);
        let mut entries = vec![
            MenuEntry {
                chip: None,
                separator: false,
                key: "g".into(),
                label: format!("Glyph · {}", safe(&draft.value.glyph)),
                choice: Choice::LabelField(LabelField::Glyph),
            },
            MenuEntry {
                chip: None,
                separator: false,
                key: "c".into(),
                label: format!("Color · {}", safe(&draft.value.color)),
                choice: Choice::LabelField(LabelField::Color),
            },
            MenuEntry {
                chip: None,
                separator: false,
                key: "n".into(),
                label: format!("Name · {}", safe(&draft.value.name)),
                choice: Choice::LabelField(LabelField::Name),
            },
            MenuEntry {
                chip: None,
                separator: false,
                key: "s".into(),
                label: "Save label".into(),
                choice: Choice::LabelSave,
            },
        ];
        if let Some(index) = draft
            .expected
            .definitions
            .iter()
            .position(|label| label.id == draft.value.id)
        {
            if index > 0 {
                entries.push(MenuEntry {
                    chip: None,
                    separator: false,
                    key: String::new(),
                    label: "Move up".into(),
                    choice: Choice::LabelMove(index - 1),
                });
            }
            if index + 1 < draft.expected.definitions.len() {
                entries.push(MenuEntry {
                    chip: None,
                    separator: false,
                    key: String::new(),
                    label: "Move down".into(),
                    choice: Choice::LabelMove(index + 1),
                });
            }
            entries.push(MenuEntry {
                chip: None,
                separator: false,
                key: "d".into(),
                label: "Delete label…".into(),
                choice: Choice::LabelDelete,
            });
        }
        self.menu = Some(Menu {
            link: None,
            prefill: String::new(),
            title: "Label editor".into(),
            entries,
            selected: 0,
            anchor: None,
            surface: Default::default(),
        });
        Effect::None
    }

    pub(super) fn edit_label_field(&mut self, field: LabelField) -> Effect {
        if field == LabelField::Color {
            let entries = ["waiting", "unread", "muted", "blocked", "working"]
                .into_iter()
                .map(|color| MenuEntry {
                    chip: None,
                    separator: false,
                    key: String::new(),
                    label: color.into(),
                    choice: Choice::LabelColor(color.into()),
                })
                .collect();
            self.menu = Some(Menu {
                link: None,
                prefill: String::new(),
                title: "Label color".into(),
                entries,
                selected: 0,
                anchor: None,
                surface: Default::default(),
            });
            return Effect::None;
        }
        let Some(draft) = &self.label_editor.draft else {
            return Effect::None;
        };
        let (prompt, value) = match field {
            LabelField::Glyph => ("Label glyph", draft.value.glyph.clone()),
            LabelField::Name => ("Label name", draft.value.name.clone()),
            LabelField::Color => unreachable!(),
        };
        self.menu = None;
        self.ask(prompt.into(), Compose::Workspace, String::new());
        self.input.as_mut().unwrap().text = value.into();
        self.label_editor.field = Some(field);
        Effect::None
    }

    pub(super) fn retain_label_field_input(&mut self) {
        let Some(input) = &self.input else { return };
        let Some(draft) = &mut self.label_editor.draft else {
            return;
        };
        match self.label_editor.field {
            Some(LabelField::Glyph) => draft.value.glyph = input.text.as_str().into(),
            Some(LabelField::Name) => draft.value.name = input.text.as_str().into(),
            _ => {}
        }
    }

    pub(super) fn submit_label_field(&mut self, value: String) -> Effect {
        let Some(field) = self.label_editor.field.take() else {
            return Effect::None;
        };
        let valid = match field {
            LabelField::Glyph => crate::config::valid_label_glyph(&value),
            LabelField::Name => !value.trim().is_empty() && !value.chars().any(char::is_control),
            LabelField::Color => false,
        };
        if !valid {
            let effect = self.edit_label_field(field);
            if let Some(input) = &mut self.input {
                input.text = value.into();
            }
            let _ = effect;
            return self.say(match field { LabelField::Glyph => "Use one nonblank character or emoji, one or two cells wide, without joined characters.", _ => "Label names must be nonblank text." });
        }
        let Some(draft) = &mut self.label_editor.draft else {
            return Effect::None;
        };
        match field {
            LabelField::Glyph => draft.value.glyph = value,
            LabelField::Name => draft.value.name = value,
            LabelField::Color => unreachable!(),
        }
        self.label_draft_menu()
    }

    pub(super) fn choose_label_color(&mut self, color: String) -> Effect {
        if let Some(draft) = &mut self.label_editor.draft {
            draft.value.color = color;
        }
        self.label_draft_menu()
    }

    pub(super) fn save_label_definition(&mut self) -> Effect {
        let Some(draft) = &self.label_editor.draft else {
            return Effect::None;
        };
        if !crate::config::valid_label_glyph(&draft.value.glyph) {
            return self.say("Use one nonblank character or emoji, one or two cells wide, without joined characters.");
        }
        if draft.value.name.trim().is_empty() || draft.value.name.chars().any(char::is_control) {
            return self.say("Label names must be nonblank text.");
        }
        self.apply_label_edit(crate::config::LabelEdit::Upsert(draft.value.clone()))
    }

    pub(super) fn move_label_definition(&mut self, index: usize) -> Effect {
        let Some(draft) = &self.label_editor.draft else {
            return Effect::None;
        };
        if draft.original.as_ref() != Some(&draft.value) {
            return self.say("Save the label before changing its order.");
        }
        self.apply_label_edit(crate::config::LabelEdit::Move {
            id: draft.value.id.clone(),
            index,
        })
    }

    pub(super) fn delete_label_definition(&mut self) -> Effect {
        let Some(draft) = &self.label_editor.draft else {
            return Effect::None;
        };
        self.confirm(
            "Delete label?".into(),
            vec![format!(
                "Remove {} and clear its member assignments?",
                crate::board::notes::single_line(&draft.value.name)
            )],
            "Delete".into(),
            Choice::LabelApply(crate::config::LabelEdit::Delete {
                id: draft.value.id.clone(),
            }),
        )
    }

    pub(super) fn apply_label_edit(&mut self, edit: crate::config::LabelEdit) -> Effect {
        if self.label_editor.save_pending {
            return self.say("A label save is already in progress.");
        }
        let Some(draft) = &self.label_editor.draft else {
            return Effect::None;
        };
        self.label_editor.save_pending = true;
        self.menu = None;
        Effect::Act(Request::LabelEdit {
            expected: draft.expected.clone(),
            edit,
        })
    }

    pub(in crate::board) fn finished_label_edit(&mut self, result: Result<OpsPreferences, String>) {
        self.label_editor.save_pending = false;
        match result {
            Ok(preferences) => {
                self.label_editor.draft = None;
                self.finished_workspace_preferences(preferences, "Labels saved.".into());
            }
            Err(error) => self.finished(Err(error)),
        }
    }
}
