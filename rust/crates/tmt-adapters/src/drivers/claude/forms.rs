//! The keys that answer a Claude form from a client (#6424), exactly as captured on the
//! versions in [`FORM_KEY_VERSIONS`] (issue #6424, comments 6889306529 and its addendum).
//! Any other version gets no keys, so its forms are answered in the terminal.
//!
//! Re-capturing for a new Claude version: drive the form on a private tmux server (its own
//! `-S` socket, `env -u TMUX -u TMUX_PANE`), send each key with `send-keys`, read the screen
//! with `capture-pane`, and compare every step with the plan below. Add the version only
//! when every row matches; otherwise change the plan under a version check.

use crate::process::{CommandRequest, CommandRunner};
use crate::runtime::provider_form::{
    Choice, FormAnswer, FormKey, FormKind, ProviderForm, QuestionAnswer,
};
use std::time::{Duration, Instant};
use tmt_core::endpoint::ProcessIncarnation;

/// The Claude Code versions whose form keys were captured.
pub const FORM_KEY_VERSIONS: &[&str] = &["2.1.325"];

/// A `--version` read inside a hook stays short; Claude answers it at once.
const VERSION_DEADLINE: Duration = Duration::from_millis(500);
const VERSION_OUTPUT: usize = 256;

/// The version the verified provider process's own executable reports, as
/// `<major>.<minor>.<patch>`. Never from `PATH`: the executable is the running process's.
pub fn provider_version(
    runner: &dyn CommandRunner,
    process: &ProcessIncarnation,
    deadline: Instant,
) -> Option<String> {
    let executable = tmt_sys::process_executable(i32::try_from(process.pid()).ok()?)?;
    let output = runner
        .execute(CommandRequest {
            program: executable.as_ref(),
            args: &["--version".into()],
            input: &[],
            deadline: deadline.min(Instant::now() + VERSION_DEADLINE),
            max_output_bytes: VERSION_OUTPUT,
        })
        .ok()?;
    let line = String::from_utf8(output.stdout).ok()?;
    super::channel::parse_build(line.trim()).map(|(_, number)| number.to_owned())
}

/// The keys that give `answer` to `form` on `version`, or `None` when that version, that
/// form kind or that shape was not captured. The answer was already checked against the form.
pub fn keys(form: &ProviderForm, version: &str, answer: &FormAnswer) -> Option<Vec<FormKey>> {
    if !FORM_KEY_VERSIONS.contains(&version) || form.truncated {
        return None;
    }
    match (form.kind, answer) {
        // Option 1 ("Yes, and use auto mode") would switch the session to auto mode, so
        // allow is option 2, "Yes, manually approve edits". Deny is a plain Esc.
        (FormKind::PlanApproval, FormAnswer::Decision(true)) => {
            Some(vec![FormKey::Down, FormKey::Enter])
        }
        (FormKind::PlanApproval, FormAnswer::Decision(false)) => Some(vec![FormKey::Escape]),
        (FormKind::Question, FormAnswer::Questions(answers))
            if answers.len() == form.questions.len() =>
        {
            question_keys(form, answers)
        }
        _ => None,
    }
}

/// A form with several questions, or any multiple choice, has a tab row and ends on a
/// review screen whose preselected "Submit answers" takes `Enter`. A one-question single
/// choice submits on its own `Enter`. The cursor starts on option 1 of each question.
fn question_keys(form: &ProviderForm, answers: &[QuestionAnswer]) -> Option<Vec<FormKey>> {
    let tabbed = form.questions.len() > 1
        || form
            .questions
            .iter()
            .any(|question| question.choice == Choice::Multiple);
    let mut keys = Vec::new();
    let down = |keys: &mut Vec<FormKey>, rows: usize| keys.extend((0..rows).map(|_| FormKey::Down));
    for (question, answer) in form.questions.iter().zip(answers) {
        // Claude always offers "Other" ("Type something.") right after the options.
        let other = question.options.len();
        if !question.free_text {
            return None;
        }
        match question.choice {
            Choice::Single => match (answer.picks.as_slice(), &answer.other) {
                ([pick], None) => {
                    down(&mut keys, *pick);
                    keys.push(FormKey::Enter);
                }
                ([], Some(text)) => {
                    down(&mut keys, other);
                    keys.extend([FormKey::Text(text.clone()), FormKey::Enter]);
                }
                _ => return None,
            },
            // `Enter` toggles the row under the cursor; typing on the "Other" row selects
            // it. The row after "Other" is `Next` (or `Submit` on the last question).
            Choice::Multiple => {
                let mut cursor = 0;
                for pick in &answer.picks {
                    down(&mut keys, pick.checked_sub(cursor)?);
                    keys.push(FormKey::Enter);
                    cursor = *pick;
                }
                if let Some(text) = &answer.other {
                    down(&mut keys, other - cursor);
                    keys.push(FormKey::Text(text.clone()));
                    cursor = other;
                }
                down(&mut keys, other + 1 - cursor);
                keys.push(FormKey::Enter);
            }
        }
    }
    if tabbed {
        keys.push(FormKey::Enter);
    }
    Some(keys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::provider_form::{FormOption, FormQuestion};
    use FormKey::{Down, Enter, Escape, Text};

    fn question(choice: Choice, options: usize) -> FormQuestion {
        FormQuestion {
            text: "q".into(),
            header: None,
            choice,
            options: (0..options)
                .map(|n| FormOption {
                    label: format!("o{n}"),
                    description: None,
                })
                .collect(),
            free_text: true,
        }
    }

    fn form(kind: FormKind, questions: Vec<FormQuestion>) -> ProviderForm {
        ProviderForm {
            kind,
            tool_use_id: None,
            questions,
            tool: None,
            plan: None,
            truncated: false,
        }
    }

    fn answer(picks: &[usize], other: Option<&str>) -> QuestionAnswer {
        QuestionAnswer {
            picks: picks.to_vec(),
            other: other.map(str::to_owned),
        }
    }

    /// Every row of the 2.1.325 capture and its addendum, and what stays unanswered.
    #[test]
    fn keys_follow_the_captured_claude_forms_on_captured_versions_only() {
        let three = form(
            FormKind::Question,
            vec![
                question(Choice::Single, 3),
                question(Choice::Multiple, 3),
                question(Choice::Single, 3),
            ],
        );
        let picked = FormAnswer::Questions(vec![
            answer(&[1], None),
            answer(&[0, 2], None),
            answer(&[], Some("abc")),
        ]);
        let text = || Text("abc".into());
        assert_eq!(
            keys(&three, "2.1.325", &picked),
            Some(vec![
                // Q1: option 2.
                Down,
                Enter,
                // Q2: toggle 1 and 3, then `Next` below "Other".
                Enter,
                Down,
                Down,
                Enter,
                Down,
                Down,
                Enter,
                // Q3: "Other" with text.
                Down,
                Down,
                Down,
                text(),
                Enter,
                // Review: "Submit answers".
                Enter,
            ])
        );
        // One single-choice question: no tab row and no review screen.
        let one = form(FormKind::Question, vec![question(Choice::Single, 3)]);
        assert_eq!(
            keys(
                &one,
                "2.1.325",
                &FormAnswer::Questions(vec![answer(&[2], None)])
            ),
            Some(vec![Down, Down, Enter])
        );
        assert_eq!(
            keys(
                &one,
                "2.1.325",
                &FormAnswer::Questions(vec![answer(&[], Some("abc"))])
            ),
            Some(vec![Down, Down, Down, text(), Enter])
        );
        // One multiple choice: a tab row, "Other" typed on its row, `Submit`, then review.
        let multiple = form(FormKind::Question, vec![question(Choice::Multiple, 3)]);
        assert_eq!(
            keys(
                &multiple,
                "2.1.325",
                &FormAnswer::Questions(vec![answer(&[0, 2], Some("xyz"))])
            ),
            Some(vec![
                Enter,
                Down,
                Down,
                Enter,
                Down,
                Text("xyz".into()),
                Down,
                Enter,
                Enter
            ])
        );
        let plan = form(FormKind::PlanApproval, vec![]);
        assert_eq!(
            keys(&plan, "2.1.325", &FormAnswer::Decision(true)),
            Some(vec![Down, Enter])
        );
        assert_eq!(
            keys(&plan, "2.1.325", &FormAnswer::Decision(false)),
            Some(vec![Escape])
        );
        // Another version, a truncated form and a permission form get no keys.
        assert_eq!(keys(&plan, "2.1.326", &FormAnswer::Decision(true)), None);
        let mut cut = one.clone();
        cut.truncated = true;
        assert_eq!(
            keys(
                &cut,
                "2.1.325",
                &FormAnswer::Questions(vec![answer(&[0], None)])
            ),
            None
        );
        let permission = form(FormKind::Permission, vec![]);
        assert_eq!(
            keys(&permission, "2.1.325", &FormAnswer::Decision(true)),
            None
        );
    }
}
