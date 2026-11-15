//! Usage repaint on `consumption.changes` (#6364). When `changes.cursor` reports a new
//! `usage`, the refresh worker asks Core which identities' usage changed since the last
//! sample and repaints only those, instead of waiting for the next timed full listing.
//! The full listing stays as the base and as reconciliation, at
//! `max(every, RECONCILE)` while deltas work and at the meter's own interval otherwise: a reset
//! or a failed delta reads in full at once, and any failure but an older Core's keeps the
//! normal interval for the rest of the run.
use crate::core::{Core, SquadError};
use serde_json::{Value, json};
use std::{
    cell::Cell,
    collections::BTreeMap,
    time::{Duration, Instant},
};

/// The full listing's period while deltas work.
pub(super) const RECONCILE: Duration = Duration::from_secs(30);

/// Which meter a sample belongs to; a delta only ever updates the base it was read for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Meter {
    Home,
    Squad(String),
}

/// What the last delta said, for the worker's period and for the next call.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Health {
    /// No delta answered yet.
    #[default]
    Unproven,
    Working,
    /// `reset: true`: the next full read is the base again; the normal period until a delta works.
    Reset,
}

#[derive(Default)]
pub(super) struct Deltas {
    health: Cell<Health>,
    /// An older Core has no `consumption.changes`: deltas are off for this run.
    unsupported: Cell<bool>,
    /// Any other failure keeps the normal period for the rest of the run.
    failed: Cell<bool>,
    base: Option<Base>,
}

struct Base {
    meter: Meter,
    /// The `usage` cursor the rows are consistent with.
    since: u64,
    /// When the full listing behind the rows was read.
    full: Instant,
    rows: BTreeMap<String, Value>,
}

/// What one delta read asks the worker to do.
#[derive(Debug, PartialEq)]
pub(super) enum Delta {
    /// Repaint these rows: the base with the changed identities merged in.
    Rows(BTreeMap<String, Value>),
    /// Do the full read now.
    Full,
    /// Nothing to do: no base yet, deltas off, or nothing changed.
    None,
}

impl Deltas {
    pub(super) fn enabled(&self) -> bool {
        !self.unsupported.get()
    }

    /// Whether a timed full listing due now can wait: only while deltas keep the figures fresh,
    /// and never longer than [`RECONCILE`] after the last one, so the listing still reconciles.
    pub(super) fn defers_full(&self, meter: &Meter, now: Instant) -> bool {
        self.health.get() == Health::Working
            && !self.failed.get()
            && !self.unsupported.get()
            && self.base.as_ref().is_some_and(|base| {
                base.meter == *meter && now.saturating_duration_since(base.full) < RECONCILE
            })
    }

    /// A full read's rows become the base. `since` is the usage cursor read just before it.
    pub(super) fn based(
        &mut self,
        meter: Meter,
        since: Option<u64>,
        rows: &BTreeMap<String, Value>,
        now: Instant,
    ) {
        self.base = since.filter(|_| self.enabled()).map(|since| Base {
            meter,
            since,
            full: now,
            rows: rows.clone(),
        });
    }

    /// Asks Core what changed since the base; `usage` is the cursor that moved.
    pub(super) fn read(&mut self, core: &Core, meter: &Meter, usage: u64) -> Delta {
        if self.unsupported.get() {
            return Delta::None;
        }
        let Some(base) = self.base.as_mut().filter(|base| base.meter == *meter) else {
            return Delta::None;
        };
        if base.since == usage {
            return Delta::None;
        }
        match changes(core, base.since) {
            Ok(Answer::Reset) => {
                self.health.set(Health::Reset);
                self.base = None;
                Delta::Full
            }
            Ok(Answer::Changed { usage, identities }) => {
                self.health.set(Health::Working);
                base.since = usage;
                for (id, item) in identities {
                    // Only the members this meter shows: the answer names any changed identity.
                    if let Some(row) = base.rows.get_mut(&id) {
                        if !row.is_object() {
                            *row = json!({});
                        }
                        row["consumption"] = item["consumption"].clone();
                        if let Some(usage) = item.get("usage") {
                            row["usage"] = usage.clone();
                        }
                    }
                }
                Delta::Rows(base.rows.clone())
            }
            Err(error) if error.code == "API_INPUT_INVALID" => {
                self.unsupported.set(true);
                self.base = None;
                Delta::None
            }
            Err(_) => {
                self.failed.set(true);
                self.base = None;
                Delta::Full
            }
        }
    }
}

enum Answer {
    Reset,
    Changed {
        usage: u64,
        identities: Vec<(String, Value)>,
    },
}

/// One `consumption.changes`, checked: a cursor, a reset flag and at most 32 named identities.
fn changes(core: &Core, since: u64) -> Result<Answer, SquadError> {
    let answer = core.api("consumption.changes", json!({"since": since}))?;
    let invalid = || {
        SquadError::new(
            "SQUAD_CORE_INVALID",
            "Core's usage changes were unreadable.",
        )
    };
    let usage = answer["usage"].as_u64().ok_or_else(invalid)?;
    if answer["reset"] == true {
        return Ok(Answer::Reset);
    }
    let identities = answer["identities"]
        .as_array()
        .filter(|items| items.len() <= 32)
        .ok_or_else(invalid)?
        .iter()
        .map(|item| Some((item["identityId"].as_str()?.to_owned(), item.clone())))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(invalid)?;
    Ok(Answer::Changed { usage, identities })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A stand-in tmt whose `api` prints the answer file, or a core error when it holds
    /// `error <code>`; each request is logged.
    fn fake(name: &str) -> (Core, PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("usage-changes-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let (answer, log) = (dir.join("answer"), dir.join("calls"));
        let tmt = dir.join("tmt");
        crate::test_support::write_ready_executable(
            &tmt,
            &format!(
                "#!/bin/sh\ncat >> '{log}'; echo >> '{log}'\n\
                 set -- $(cat '{answer}')\n\
                 if [ \"$1\" = error ]; then\n\
                 echo \"{{\\\"error\\\":{{\\\"code\\\":\\\"$2\\\",\\\"message\\\":\\\"no\\\"}}}}\"; exit 2\n\
                 fi\n\
                 cat '{answer}'\n",
                log = log.display(),
                answer = answer.display(),
            ),
        );
        (Core::at(tmt), answer, dir)
    }

    fn rows() -> BTreeMap<String, Value> {
        BTreeMap::from([
            (
                "a".to_owned(),
                json!({"consumption": {"total": 1}, "usage": {"windowTokens": 10}}),
            ),
            ("b".to_owned(), json!({"consumption": {"total": 2}})),
        ])
    }

    fn based(meter: Meter) -> Deltas {
        let mut deltas = Deltas::default();
        deltas.based(meter, Some(7), &rows(), Instant::now());
        deltas
    }

    #[test]
    fn a_delta_changes_only_the_identities_core_names_and_moves_the_cursor() {
        let (core, answer, dir) = fake("rows");
        let squad = Meter::Squad("product".into());
        let mut deltas = based(squad.clone());
        std::fs::write(
            &answer,
            json!({"usage": 9, "reset": false, "identities": [
                {"identityId": "a", "consumption": {"total": 5}, "usage": {"windowTokens": 20}},
                {"identityId": "elsewhere", "consumption": {"total": 99}}
            ]})
            .to_string(),
        )
        .unwrap();
        let Delta::Rows(rows) = deltas.read(&core, &squad, 9) else {
            panic!("a delta repaints");
        };
        assert_eq!(rows["a"]["consumption"]["total"], 5);
        assert_eq!(rows["a"]["usage"]["windowTokens"], 20);
        assert_eq!(rows["b"], json!({"consumption": {"total": 2}}), "unchanged");
        assert!(!rows.contains_key("elsewhere"), "only this meter's members");
        let calls = std::fs::read_to_string(dir.join("calls")).unwrap();
        assert!(calls.contains(r#""since":7"#), "{calls}");
        assert_eq!(
            deltas.read(&core, &squad, 9),
            Delta::None,
            "the cursor moved to 9"
        );
        assert!(
            deltas.defers_full(&squad, Instant::now()),
            "the full read can wait"
        );
        assert!(
            !deltas.defers_full(&squad, Instant::now() + RECONCILE),
            "but never past the reconcile period"
        );
        assert_eq!(
            deltas.read(&core, &Meter::Home, 10),
            Delta::None,
            "another meter's base"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_reset_reads_in_full_now_and_keeps_the_normal_interval() {
        let (core, answer, dir) = fake("reset");
        let mut deltas = based(Meter::Home);
        std::fs::write(&answer, r#"{"usage": 40, "reset": true, "identities": []}"#).unwrap();
        assert_eq!(deltas.read(&core, &Meter::Home, 40), Delta::Full);
        deltas.based(Meter::Home, Some(40), &rows(), Instant::now());
        assert!(!deltas.defers_full(&Meter::Home, Instant::now()));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_older_core_keeps_the_timed_read_and_another_failure_reads_in_full_once() {
        let (core, answer, dir) = fake("older");
        let mut deltas = based(Meter::Home);
        std::fs::write(&answer, "error API_INPUT_INVALID").unwrap();
        assert_eq!(deltas.read(&core, &Meter::Home, 8), Delta::None);
        assert!(!deltas.enabled(), "never asked again this run");
        deltas.based(Meter::Home, Some(8), &rows(), Instant::now());
        assert_eq!(deltas.read(&core, &Meter::Home, 9), Delta::None);
        assert_eq!(
            std::fs::read_to_string(dir.join("calls"))
                .unwrap()
                .lines()
                .count(),
            1
        );

        let mut deltas = based(Meter::Home);
        std::fs::write(&answer, r#"{"usage": 8, "reset": false, "identities": []}"#).unwrap();
        assert!(matches!(
            deltas.read(&core, &Meter::Home, 8),
            Delta::Rows(_)
        ));
        std::fs::write(&answer, "error API_UNAVAILABLE").unwrap();
        assert_eq!(deltas.read(&core, &Meter::Home, 9), Delta::Full);
        deltas.based(Meter::Home, Some(9), &rows(), Instant::now());
        std::fs::write(
            &answer,
            r#"{"usage": 10, "reset": false, "identities": []}"#,
        )
        .unwrap();
        assert!(matches!(
            deltas.read(&core, &Meter::Home, 10),
            Delta::Rows(_)
        ));
        assert!(
            !deltas.defers_full(&Meter::Home, Instant::now()),
            "the normal interval for the rest of the run"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
