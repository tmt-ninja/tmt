//! Sending rules and talk limits inside the request preparation transaction (#4892).
//! The rules are `tmt_core::orchestration::sending`; this reads their facts at the
//! transaction's captured instant and records holds. No counter table: the pair count is
//! read from the stored requests.
use super::{ReceivingCalendar, StorageError, append, classify, corrupt, read_snapshot};
use crate::storage::Storage;
use rusqlite::{Connection, OptionalExtension, params};
use tmt_core::orchestration::{sending::*, *};

impl ReceivingCalendar {
    pub(in crate::storage) fn talk_admission(
        &self,
        db: &Connection,
        from: &str,
        to: &str,
        now: u64,
    ) -> Result<OrchTalkAdmission, StorageError> {
        let stored = read_snapshot(db, None, None)?;
        if stored.snapshot.revision == 0 {
            // A fresh store is Base only: anyone sends, unlimited.
            return Ok(OrchTalkAdmission::Allowed);
        }
        let zone = self
            .zone
            .as_ref()
            .filter(|_| self.configured_zone == stored.time_zone)
            .ok_or_else(|| {
                StorageError::new(
                    super::StorageErrorCode::Busy,
                    "Orchestration calendar selection changed; retry the operation.",
                )
            })?;
        let sender = effective(&stored.snapshot, from, now, zone).map_err(|_| corrupt())?;
        let leads = active_leads(&stored.snapshot);
        let grant = stored
            .snapshot
            .route_grants
            .iter()
            .find(|g| g.from_id == from && g.to_id == to)
            .map(|g| g.until_ms);
        if let OrchRoute::Restricted { sending, source } =
            route(&sender.sending, leads.contains(&to), grant, now)
        {
            return Ok(OrchTalkAdmission::Restricted(Box::new(OrchRouteRefusal {
                sender_id: from.into(),
                recipient_id: to.into(),
                sending,
                source,
                configuration_revision: stored.snapshot.revision,
                time_zone: zone.name().into(),
            })));
        }
        // A lead's requests are never counted or held.
        if leads.contains(&from) {
            return Ok(OrchTalkAdmission::Allowed);
        }
        let recipient = effective(&stored.snapshot, to, now, zone).map_err(|_| corrupt())?;
        let Some(limit) = pair_limit(sender.talk_limit.value, recipient.talk_limit.value) else {
            return Ok(OrchTalkAdmission::Allowed);
        };
        let start = talk_window_start(now, resumed_at(db, from, to)?);
        let counted = pair_count(db, from, to, start)?;
        Ok(if needs_person(counted, Some(limit)) {
            OrchTalkAdmission::NeedsPerson { counted, limit }
        } else {
            OrchTalkAdmission::Allowed
        })
    }

    /// Record the hold and its decision in the caller's transaction.
    pub(in crate::storage) fn hold_for_person(
        &self,
        db: &Connection,
        request_id: &str,
        from: &str,
        to: &str,
        now: u64,
    ) -> Result<(), StorageError> {
        db.execute(
            "INSERT INTO orchestration_talk_holds (request_id,from_id,to_id,held_ms) VALUES (?,?,?,?)",
            params![request_id, from, to, now as i64],
        )
        .map_err(|e| classify(e, "Hold request for a person"))?;
        // It waits for a person up to 7 days, never past its retained text (#4892 ruling).
        db.execute(
            "UPDATE request_attempts SET expires_at_ms = MIN(?2, COALESCE(message_expires_at_ms, ?2)) \
             WHERE request_id=?1",
            params![request_id, now.saturating_add(ORCH_HOLD_MS) as i64],
        )
        .map_err(|e| classify(e, "Extend held request expiry"))?;
        let stored = read_snapshot(db, None, None)?;
        let zone = self.zone.as_ref().ok_or_else(corrupt)?;
        let source = effective(&stored.snapshot, from, now, zone)
            .map_err(|_| corrupt())?
            .talk_limit
            .source;
        append(
            db,
            &OrchDecision {
                recorded_at_ms: now,
                subject_kind: OrchSubjectKind::Request,
                subject_id: request_id.into(),
                actor_id: Some(from.into()),
                recipient_id: Some(to.into()),
                action: OrchDecisionAction::Delay,
                outcome: OrchDecisionOutcome::Held,
                reason: "talk_limit".into(),
                configuration_revision: stored.snapshot.revision,
                time_zone: zone.name().into(),
                sources: vec![OrchDecisionSource {
                    field: OrchPolicyField::TalkLimit,
                    source,
                }],
            },
        )?;
        Ok(())
    }
}

impl ReceivingCalendar {
    /// One journal entry when a held request expires unsent (#4892 ruling). The hold row
    /// stays so `talks` and `x show` report it; resume skips it by its expiry.
    pub(in crate::storage) fn expire_person_hold(
        &self,
        db: &Connection,
        request_id: &str,
        now: u64,
    ) -> Result<(), StorageError> {
        let Some(to) = db
            .query_row(
                "SELECT to_id FROM orchestration_talk_holds WHERE request_id=?",
                [request_id],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| classify(e, "Read expiring hold"))?
        else {
            return Ok(());
        };
        let stored = read_snapshot(db, None, None)?;
        // Expiry must not depend on a resolvable zone; the name is only attribution.
        let time_zone = match (&self.zone, &self.configured_zone) {
            (Some(zone), _) => zone.name().to_owned(),
            (None, Some(name)) => name.clone(),
            (None, None) => "UTC".to_owned(),
        };
        append(
            db,
            &OrchDecision {
                recorded_at_ms: now,
                subject_kind: OrchSubjectKind::Request,
                subject_id: request_id.into(),
                actor_id: None,
                recipient_id: Some(to),
                action: OrchDecisionAction::Delay,
                outcome: OrchDecisionOutcome::Failed,
                reason: "talk_hold_expired".into(),
                configuration_revision: stored.snapshot.revision,
                time_zone,
                sources: Vec::new(),
            },
        )?;
        Ok(())
    }
}

/// Requests held at the talk limit between `a` and `b`, both directions, oldest first.
pub(in crate::storage) fn held_for_person(
    db: &Connection,
    a: &str,
    b: &str,
) -> Result<Vec<OrchHeld>, StorageError> {
    let mut query = db
        .prepare(
            "SELECT h.request_id,r.attempt_id,h.from_id,h.to_id,h.held_ms,r.expires_at_ms \
             FROM orchestration_talk_holds h JOIN request_attempts r ON r.request_id=h.request_id \
             WHERE (h.from_id=?1 AND h.to_id=?2) OR (h.from_id=?2 AND h.to_id=?1) \
             ORDER BY h.held_ms,h.request_id",
        )
        .map_err(|e| classify(e, "Prepare held requests"))?;
    let rows = query
        .query_map(params![a, b], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })
        .map_err(|e| classify(e, "Read held requests"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| classify(e, "Decode held requests"))?;
    rows.into_iter()
        .map(|(request_id, attempt_id, from_id, to_id, held, expires)| {
            Ok(OrchHeld {
                request_id,
                attempt_id,
                from_id,
                to_id,
                held_ms: u64::try_from(held).map_err(|_| corrupt())?,
                expires_at_ms: u64::try_from(expires).map_err(|_| corrupt())?,
            })
        })
        .collect()
}

impl ReceivingCalendar {
    /// Drop the pair's holds, restart its window, refresh each live attempt's expiry and
    /// journal each release, all in the caller's transaction.
    pub(in crate::storage) fn release_person_holds(
        &self,
        db: &Connection,
        a: &str,
        b: &str,
        released: &[OrchHeld],
        actor: Option<&str>,
        now: u64,
    ) -> Result<(), StorageError> {
        db.execute(
            "DELETE FROM orchestration_talk_holds WHERE (from_id=?1 AND to_id=?2) OR (from_id=?2 AND to_id=?1)",
            params![a, b],
        )
        .map_err(|e| classify(e, "Release held requests"))?;
        let (first, second) = ordered(a, b);
        db.execute(
            "INSERT INTO orchestration_talk_resumes(first_id,second_id,resumed_ms) VALUES(?1,?2,?3) \
             ON CONFLICT(first_id,second_id) DO UPDATE SET resumed_ms=excluded.resumed_ms",
            params![first, second, now as i64],
        )
        .map_err(|e| classify(e, "Record talk resume"))?;
        let stored = read_snapshot(db, None, None)?;
        let zone = self.zone.as_ref().ok_or_else(corrupt)?;
        for held in released {
            db.execute(
                "UPDATE request_attempts SET expires_at_ms=?2 WHERE request_id=?1",
                params![
                    held.request_id,
                    now.saturating_add(tmt_core::retention::REQUEST_MIN_EXPIRY_MS) as i64
                ],
            )
            .map_err(|e| classify(e, "Refresh released request expiry"))?;
            append(
                db,
                &OrchDecision {
                    recorded_at_ms: now,
                    subject_kind: OrchSubjectKind::Request,
                    subject_id: held.request_id.clone(),
                    actor_id: actor.map(str::to_owned),
                    recipient_id: Some(held.to_id.clone()),
                    action: OrchDecisionAction::Send,
                    outcome: OrchDecisionOutcome::Allowed,
                    reason: "talk_resumed".into(),
                    configuration_revision: stored.snapshot.revision,
                    time_zone: zone.name().into(),
                    sources: Vec::new(),
                },
            )?;
        }
        Ok(())
    }
}

/// One agent pair's talk facts at an instant, for the `talks` and `routes` views. The two
/// members are in canonical order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrchTalkPair {
    pub first_id: String,
    pub second_id: String,
    /// Counted requests since `window_start_ms` (the same count admission uses).
    pub count: u64,
    pub last_at_ms: Option<u64>,
    pub window_start_ms: u64,
    pub held: Vec<OrchHeld>,
}

impl Storage {
    /// Every pair with a request in the last window or a held request, ordered by pair.
    pub fn orchestration_talks(&self, now: u64) -> Result<Vec<OrchTalkPair>, StorageError> {
        let tx = self
            .connection()?
            .unchecked_transaction()
            .map_err(|e| classify(e, "Read talk pairs"))?;
        let pairs = {
            let mut query = tx
                .prepare(
                    "SELECT MIN(originator_identity_id,recipient_identity_id),\
                       MAX(originator_identity_id,recipient_identity_id) FROM request_attempts \
                     WHERE request_kind='request' AND prepared_at_ms >= ?1 \
                       AND originator_identity_id IS NOT NULL AND recipient_identity_id IS NOT NULL \
                       AND originator_identity_id <> recipient_identity_id \
                     UNION SELECT MIN(from_id,to_id),MAX(from_id,to_id) FROM orchestration_talk_holds \
                     ORDER BY 1,2",
                )
                .map_err(|e| classify(e, "Prepare talk pairs"))?;
            query
                .query_map(
                    params![now.saturating_sub(ORCH_TALK_WINDOW_MS) as i64],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                )
                .map_err(|e| classify(e, "Read talk pairs"))?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| classify(e, "Decode talk pairs"))?
        };
        let mut out = Vec::with_capacity(pairs.len());
        for (first_id, second_id) in pairs {
            let window_start_ms = talk_window_start(now, resumed_at(&tx, &first_id, &second_id)?);
            let last_at_ms = tx
                .query_row(
                    "SELECT MAX(prepared_at_ms) FROM request_attempts WHERE request_kind='request' \
                     AND ((originator_identity_id=?1 AND recipient_identity_id=?2) \
                       OR (originator_identity_id=?2 AND recipient_identity_id=?1))",
                    params![first_id, second_id],
                    |r| r.get::<_, Option<i64>>(0),
                )
                .map_err(|e| classify(e, "Read last pair request"))?
                .map(|ms| u64::try_from(ms).map_err(|_| corrupt()))
                .transpose()?;
            out.push(OrchTalkPair {
                count: pair_count(&tx, &first_id, &second_id, window_start_ms)?,
                held: held_for_person(&tx, &first_id, &second_id)?,
                last_at_ms,
                window_start_ms,
                first_id,
                second_id,
            });
        }
        tx.commit().map_err(|e| classify(e, "Finish talk pairs"))?;
        Ok(out)
    }

    /// Requests held at the talk limit between `a` and `b`, oldest first.
    pub fn orchestration_held(&self, a: &str, b: &str) -> Result<Vec<OrchHeld>, StorageError> {
        held_for_person(self.connection()?, a, b)
    }
}

/// Stored leads whose identities are still active; a retired one drops out here, not by
/// rewriting the list.
pub fn active_leads(snapshot: &OrchSnapshot) -> Vec<&str> {
    snapshot
        .leads
        .iter()
        .filter(|id| snapshot.identities.iter().any(|i| &i.id == *id))
        .map(String::as_str)
        .collect()
}

fn ordered<'a>(a: &'a str, b: &'a str) -> (&'a str, &'a str) {
    if a < b { (a, b) } else { (b, a) }
}

fn resumed_at(db: &Connection, a: &str, b: &str) -> Result<Option<u64>, StorageError> {
    let (first, second) = ordered(a, b);
    db.query_row(
        "SELECT resumed_ms FROM orchestration_talk_resumes WHERE first_id=? AND second_id=?",
        params![first, second],
        |r| r.get::<_, i64>(0),
    )
    .optional()
    .map_err(|e| classify(e, "Read talk resume"))?
    .map(|ms| u64::try_from(ms).map_err(|_| corrupt()))
    .transpose()
}

/// New requests between the two, both directions, prepared since `start`. Held requests
/// and requests from a current lead are not counted.
fn pair_count(db: &Connection, a: &str, b: &str, start: u64) -> Result<u64, StorageError> {
    db.query_row(
        "SELECT COUNT(*) FROM request_attempts r \
         WHERE r.request_kind='request' AND r.prepared_at_ms >= ?1 \
         AND ((r.originator_identity_id=?2 AND r.recipient_identity_id=?3) \
           OR (r.originator_identity_id=?3 AND r.recipient_identity_id=?2)) \
         AND NOT EXISTS (SELECT 1 FROM orchestration_talk_holds h WHERE h.request_id=r.request_id) \
         AND NOT EXISTS (SELECT 1 FROM orchestration_leads l JOIN identities i ON i.id=l.identity_id \
           WHERE l.identity_id=r.originator_identity_id AND i.retired_at_ms IS NULL)",
        params![start as i64, a, b],
        |r| r.get::<_, i64>(0),
    )
    .map_err(|e| classify(e, "Count pair requests"))
    .and_then(|n| u64::try_from(n).map_err(|_| corrupt()))
}

/// Journal a refused route (subject = sender, action `block`) in the caller's transaction.
pub(in crate::storage) fn append_route_refusal(
    db: &Connection,
    refusal: &OrchRouteRefusal,
    now: u64,
) -> Result<(), StorageError> {
    append(db, &route_refusal_decision(refusal, now))?;
    Ok(())
}

/// The one shape of a route refusal's journal entry.
pub fn route_refusal_decision(refusal: &OrchRouteRefusal, now: u64) -> OrchDecision {
    OrchDecision {
        recorded_at_ms: now,
        subject_kind: OrchSubjectKind::Identity,
        subject_id: refusal.sender_id.clone(),
        actor_id: Some(refusal.sender_id.clone()),
        recipient_id: Some(refusal.recipient_id.clone()),
        action: OrchDecisionAction::Block,
        outcome: OrchDecisionOutcome::Failed,
        reason: "route_restricted".into(),
        configuration_revision: refusal.configuration_revision,
        time_zone: refusal.time_zone.clone(),
        sources: vec![OrchDecisionSource {
            field: OrchPolicyField::Sending,
            source: refusal.source.clone(),
        }],
    }
}
