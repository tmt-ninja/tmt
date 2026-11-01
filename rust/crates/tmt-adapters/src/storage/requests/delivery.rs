//! The stored facts behind one message's delivery state. Everything here is a
//! row read inside the request transaction: no process, pane or file is touched.
use super::*;
use tmt_core::{
    binding::{
        BindingRecords,
        session::activity::{Activity, ActivityPhase},
    },
    request::{
        delivery::{DeliveryFacts, DigestHold, RecipientActivity, ReturnedAnswer},
        passthrough::{CaptureState, RunningTurn},
    },
};

/// What every row to one recipient shares: who it is, why it cannot start, its Digest limit, its
/// activity and, read only once a held row needs it, its oldest held item and calendar limit.
#[derive(Clone, Default)]
pub(super) struct Recipient {
    is_user: bool,
    start_refusal: Option<tmt_core::binding::session::StartRefusalReason>,
    name: Option<String>,
    recovery: Option<String>,
    max_hold_ms: Option<u64>,
    activity: Option<RecipientActivity>,
    oldest_held_at_ms: Option<Option<u64>>,
    /// Read on first need: whether a calendar policy applies, and then its hold limit.
    pub(super) receiving_max_hold_ms: Option<Option<Option<u64>>>,
}

/// One transaction's recipient facts, each tagged with the change cursor it was read at (#5862). A
/// page of rows reads each recipient once; any durable change in the transaction advances the
/// cursor, so a later row never sees facts older than the store.
#[derive(Default)]
pub(super) struct Recipients(
    std::cell::RefCell<std::collections::HashMap<String, (i64, Recipient)>>,
);

fn change_cursor(db: &Connection) -> Result<i64, StorageError> {
    db.query_row("SELECT value FROM change_cursor WHERE id=1", [], |r| {
        r.get(0)
    })
    .map_err(|e| classify(e, "Read change cursor"))
}

fn read_recipient(db: &Connection, id: &str, now: u64) -> Result<Recipient, StorageError> {
    let rows = crate::storage::bindings::BindingRows(db);
    let entry = rows.entry_by_id(id)?;
    let mut start_refusal = entry
        .as_ref()
        .and_then(|entry| entry.binding.as_ref())
        .and_then(|binding| binding.session.start_refusal.as_ref())
        .map(|refusal| refusal.reason);
    let mut recovery = None;
    if start_refusal.is_none()
        && let Some(entry) = entry.as_ref()
        && let Some(binding) = entry.binding.as_ref()
        && let Some(observed) = crate::storage::launch_observations::latest(db, &binding.id, now)?
        && observed.status != tmt_core::binding::session::launch::LaunchStatus::Admitted
        && observed.diagnostic.is_some()
    {
        start_refusal = Some(tmt_core::binding::session::StartRefusalReason::SessionNotLearned);
        let preferences = rows.session_preferences(&entry.identity.id)?;
        let fix = tmt_core::binding::session::launch::session_learning_recovery(
            &entry.identity,
            &observed.driver,
            &preferences,
        );
        recovery = Some(if fix.len() + "session not bound · ".len() <= 256 {
            fix
        } else {
            format!(
                "Inspect the recipient and its next step: tmt identity show {}",
                entry.identity.id
            )
        });
    }
    Ok(Recipient {
        is_user: RequestRows(db, None, None, None).identity_is_user(id)?,
        start_refusal,
        name: entry.map(|entry| entry.identity.name),
        recovery,
        max_hold_ms: digest::policy(db, id)?.and_then(|policy| policy.max_hold_ms),
        activity: activity(db, id)?,
        oldest_held_at_ms: None,
        receiving_max_hold_ms: None,
    })
}

impl Recipients {
    /// The recipient's facts, from this transaction's cache while nothing changed; `fill` adds a
    /// lazily read field to the cached entry.
    pub(super) fn get(
        cache: Option<&Self>,
        db: &Connection,
        id: &str,
        now: u64,
        fill: impl FnOnce(&mut Recipient) -> Result<(), StorageError>,
    ) -> Result<Recipient, StorageError> {
        let Some(cache) = cache else {
            let mut recipient = read_recipient(db, id, now)?;
            fill(&mut recipient)?;
            return Ok(recipient);
        };
        let cursor = change_cursor(db)?;
        let mut entries = cache.0.borrow_mut();
        let entry = match entries.get_mut(id) {
            Some(entry) if entry.0 == cursor => entry,
            _ => {
                let recipient = read_recipient(db, id, now)?;
                entries.insert(id.to_owned(), (cursor, recipient));
                entries.get_mut(id).expect("just inserted")
            }
        };
        fill(&mut entry.1)?;
        Ok(entry.1.clone())
    }
}

pub(super) fn facts(
    db: &Connection,
    attempt: &RequestAttempt,
    now: u64,
    cache: Option<&Recipients>,
) -> Result<DeliveryFacts, StorageError> {
    let id = attempt.recipient_identity_id.as_deref();
    let hold = id
        .map(|id| hold(db, id, &attempt.request_id))
        .transpose()?
        .flatten();
    // Only a request still held reads the recipient's oldest held item; it bounds that hold's
    // latest send (#5862).
    let held_open = matches!(hold, Some(DigestHold::Open { .. }));
    let recipient = id
        .map(|id| {
            Recipients::get(cache, db, id, now, |recipient| {
                if held_open && recipient.oldest_held_at_ms.is_none() {
                    recipient.oldest_held_at_ms = Some(digest::oldest_held(db, id, now)?);
                }
                Ok(())
            })
        })
        .transpose()?
        .unwrap_or_default();
    Ok(DeliveryFacts {
        recipient_is_user: recipient.is_user,
        recipient_start_refusal: recipient.start_refusal,
        recipient_name: recipient.name,
        recipient_session_recovery: recipient.recovery,
        status: attempt.status,
        inbox: matches!(attempt.route, RequestRoute::Inbox { .. }),
        wake: RequestRows(db, None, None, None)
            .wake_state(&attempt.request_id)?
            .unwrap_or(WakeState::NotAttempted),
        prepared_at_ms: attempt.prepared_at_ms,
        settled_at_ms: attempt.settled_at_ms,
        hold,
        max_hold_ms: recipient.max_hold_ms,
        oldest_held_at_ms: if held_open {
            recipient.oldest_held_at_ms.flatten()
        } else {
            None
        },
        recipient: recipient.activity,
        turn: super::turns::read(db, &attempt.request_id)?,
        answer: answer(db, attempt, now)?,
        talk_held: db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM orchestration_talk_holds WHERE request_id=?)",
                [&attempt.request_id],
                |r| r.get::<_, bool>(0),
            )
            .map_err(|e| classify(e, "Read talk-limit hold"))?,
    })
}

/// A submitted reply, else the passthrough capture as it reads at `now`.
fn answer(
    db: &Connection,
    attempt: &RequestAttempt,
    now: u64,
) -> Result<ReturnedAnswer, StorageError> {
    if attempt.response_submitted_at_ms.is_some() {
        return Ok(ReturnedAnswer::Final);
    }
    Ok(match passthrough::capture(db, &attempt.request_id)? {
        Some(capture) => match capture.state_at(now) {
            CaptureState::Answered => ReturnedAnswer::Turn {
                folded: capture.folded,
            },
            CaptureState::NoAnswer => ReturnedAnswer::NoCapture {
                bound: capture.bound_at_ms.is_some(),
            },
            CaptureState::Pending | CaptureState::Bound => ReturnedAnswer::None,
        },
        None => ReturnedAnswer::None,
    })
}

fn hold(
    db: &Connection,
    identity: &str,
    request: &str,
) -> Result<Option<DigestHold>, StorageError> {
    db.query_row(
        "SELECT i.created_at_ms, c.state, c.opportunity, c.confirmed_at_ms FROM focus_items i
         LEFT JOIN focus_checklists c ON c.id = i.checklist_id
         WHERE i.identity_id = ?1 AND i.request_id = ?2 AND i.source = 'incoming'",
        params![identity, request],
        |row| {
            Ok(match row.get::<_, Option<String>>(1)?.as_deref() {
                None | Some("definitely_unsent") => DigestHold::Open {
                    since_ms: rows::u64_at(row, 0)?,
                },
                Some("claimed") => DigestHold::Claimed,
                Some("delivered")
                    if row.get::<_, Option<String>>(2)?.as_deref() == Some("idle")
                        && row.get::<_, Option<i64>>(3)?.is_none() =>
                {
                    DigestHold::Unconfirmed
                }
                Some("delivered") => DigestHold::Delivered,
                Some(_) => DigestHold::Uncertain,
            })
        },
    )
    .optional()
    .map_err(|error| classify(error, "Read a message's digest hold"))
}

/// The driver's last admitted event for the exact session and process the
/// recipient is bound to now. It is not liveness evidence: a stopped process
/// keeps its last phase until a new binding replaces it.
pub(super) fn activity(
    db: &Connection,
    identity: &str,
) -> Result<Option<RecipientActivity>, StorageError> {
    Ok(
        verified_activity(db, identity)?.map(|(_, activity)| RecipientActivity {
            phase: activity.phase,
            since_ms: activity.since_ms,
        }),
    )
}

/// Whether text typed into the recipient's pane now reaches the model without a prompt of its own:
/// its driver folds typed text into a running turn, and a turn runs or a Stop-hook continuation is
/// still open (it reads idle until its own Stop). Such a paste is carried, not lost (#5869).
pub(super) fn folds_typed_text_now(db: &Connection, identity: &str) -> Result<bool, StorageError> {
    let Some((driver, activity)) = verified_activity(db, identity)? else {
        return Ok(false);
    };
    if !tmt_core::driver::descriptor::named(&driver).is_some_and(|d| d.folds_queued_text) {
        return Ok(false);
    }
    Ok(activity.phase == ActivityPhase::Working || digest::continuation_open(db, identity)?)
}

/// The turn that [`activity`] shows running, with the session and turn id it can be bound by, when
/// the recipient's driver folds text typed into a running turn (`folds_queued_text`). For any other
/// driver the answer is none, so its passthrough keeps prompt matching (#4912).
pub(super) fn running_turn(
    db: &Connection,
    identity: &str,
) -> Result<Option<RunningTurn>, StorageError> {
    Ok(verified_activity(db, identity)?
        .filter(|(driver, activity)| {
            activity.phase == ActivityPhase::Working
                && tmt_core::driver::descriptor::named(driver)
                    .is_some_and(|descriptor| descriptor.folds_queued_text)
        })
        .map(|(_, activity)| RunningTurn {
            session: activity.session.as_str().to_owned(),
            turn: activity.turn.map(|turn| turn.as_str().to_owned()),
            since_ms: activity.since_ms,
        }))
}

/// The activity of the exact session and process the recipient is bound to, with the driver that
/// reported it.
fn verified_activity(
    db: &Connection,
    identity: &str,
) -> Result<Option<(String, Activity)>, StorageError> {
    let rows = crate::storage::bindings::BindingRows(db);
    let Some(key) = rows
        .entry_by_id(identity)?
        .and_then(|entry| entry.binding)
        .and_then(|binding| binding.session.key)
    else {
        return Ok(None);
    };
    let preferences = rows.session_preferences(identity)?;
    Ok(preferences
        .remembered
        .as_ref()
        .filter(|remembered| key.provider_session.as_ref() == Some(&remembered.provider_session))
        .and_then(|remembered| {
            let activity = remembered
                .state
                .as_ref()
                .and_then(crate::runtime::driver_state::state_activity)?;
            activity
                .matches(&remembered.provider_session, &key.incarnation)
                .then(|| (remembered.harness.as_str().to_owned(), activity))
        }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestDirectory;

    /// A page of rows to one recipient reads its facts once while the store is unchanged, and
    /// reads them again after any change (#5862).
    #[test]
    fn rows_to_one_recipient_share_one_read_until_the_store_changes() {
        const ID: &str = "11111111-1111-4111-8111-111111111111";
        let directory = TestDirectory::new();
        let mut storage =
            crate::storage::Storage::open(directory.path.join("requests.db")).unwrap();
        let db = storage.connection().unwrap();
        db.execute("INSERT INTO identities (id,name,canonical_name,created_at,updated_at,lifetime) VALUES (?,'Ada','ada','t','t','saved')", [ID]).unwrap();
        let cache = Recipients::default();
        let name = |db: &Connection| {
            Recipients::get(Some(&cache), db, ID, 1, |_| Ok(()))
                .unwrap()
                .name
        };
        assert_eq!(name(db).as_deref(), Some("Ada"));
        // Rename under a restored cursor: the cached read is served, not a new one.
        let cursor = change_cursor(db).unwrap();
        db.execute("UPDATE identities SET name='Bea' WHERE id=?", [ID])
            .unwrap();
        db.execute("UPDATE change_cursor SET value=? WHERE id=1", [cursor])
            .unwrap();
        assert_eq!(name(db).as_deref(), Some("Ada"), "one read per recipient");
        // Any durable change advances the cursor, so the next row reads fresh facts.
        db.execute("UPDATE identities SET name='Cy' WHERE id=?", [ID])
            .unwrap();
        assert_eq!(name(db).as_deref(), Some("Cy"));
        assert_eq!(
            Recipients::get(None, db, ID, 1, |_| Ok(()))
                .unwrap()
                .name
                .as_deref(),
            Some("Cy"),
            "without a cache every row reads"
        );
        storage.close().unwrap();
    }
}
