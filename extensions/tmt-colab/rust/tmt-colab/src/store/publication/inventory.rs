//! Read-only content inventory (#5366): every retained content payload of a page, counted once
//! under the first retention reason that keeps it. It writes nothing and changes no rule; the
//! prune estimate uses the very candidates `prune` removes.
use super::{
    CHECKPOINT_CANDIDATES, Fault, RECEIPT_CANDIDATES, Store, StoreResult, StreamScope, bounded_id,
    has_active_tail, paired, prune_bounds, sequence,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::collections::BTreeMap;

/// Why a retained content payload is kept, in precedence order: a payload with several reasons
/// is counted under the first, and its other reasons appear only in `overlaps`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    /// A stream of an earlier epoch: its signed cut needs it.
    OldEpoch,
    /// The owner fold at the latest paired cut, or the update it binds.
    OwnerSigned,
    Pinned,
    /// The checkpoint at the latest paired cut, which bootstrap starts from.
    LatestPaired,
    /// History the cloud has not confirmed yet.
    Unconfirmed,
    /// The tail after the paired cut, a checkpoint newer than it, or every update of a stream
    /// with no paired cut: the current page needs it.
    Bootstrap,
    /// Removed by `prune` under the current rules: the current-contract estimate.
    PruneableNow,
    /// Older than the paired cut and unprotected, yet kept because its stream has no active tail:
    /// what a new baseline generation could free.
    Superseded,
    /// A checkpoint no paired cut accounts for; never counted as savings.
    Unknown,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Tally {
    pub rows: u64,
    pub bytes: u64,
}
impl Tally {
    fn add(&mut self, bytes: u64) -> StoreResult<()> {
        self.rows = self.rows.checked_add(1).ok_or(Fault::Capacity)?;
        self.bytes = self.bytes.checked_add(bytes).ok_or(Fault::Capacity)?;
        Ok(())
    }
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentInventory {
    pub streams: u64,
    pub reasons: BTreeMap<Reason, Tally>,
    /// Payloads kept for more than one reason, keyed by every reason joined with `+`.
    pub overlaps: BTreeMap<String, Tally>,
    /// Never candidate savings: comments and own records, and baselines by epoch.
    pub own: Tally,
    pub baseline_current: Tally,
    pub baseline_old: Tally,
    /// The receipt ledger: rows whose payload was already removed still keep hash and digest.
    pub receipt_rows: u64,
    pub pruned_receipt_rows: u64,
}
impl ContentInventory {
    pub fn total(&self, reason: Reason) -> u64 {
        self.reasons.get(&reason).map_or(0, |tally| tally.bytes)
    }
    /// Every content and baseline byte, which `page_storage_bytes` splits into content and history.
    pub fn content_and_history(&self) -> StoreResult<u64> {
        self.reasons
            .values()
            .chain([&self.baseline_current, &self.baseline_old])
            .try_fold(0u64, |sum, tally| sum.checked_add(tally.bytes))
            .ok_or(Fault::Capacity)
    }
}

struct Row {
    checkpoint: bool,
    seq: String,
    signed: bool,
    pinned: bool,
    candidate: bool,
    bytes: u64,
}

impl Store {
    /// Classify a page's retained payloads inside one read snapshot. Nothing is written.
    pub fn content_inventory(&self, page: &str) -> StoreResult<ContentInventory> {
        bounded_id(page)?;
        let tx = self.connection.unchecked_transaction()?;
        let inventory = inventory(&tx, page)?;
        tx.rollback()?;
        Ok(inventory)
    }
}

fn inventory(c: &Connection, page: &str) -> StoreResult<ContentInventory> {
    let current: String = c.query_row("SELECT epoch FROM pages WHERE page=?1", [page], |r| {
        r.get(0)
    })?;
    let mut out = ContentInventory::default();
    let mut streams =
        c.prepare("SELECT epoch,stream FROM streams WHERE page=?1 ORDER BY epoch,stream")?;
    let streams = streams
        .query_map([page], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (epoch, stream) in streams {
        out.streams = out.streams.checked_add(1).ok_or(Fault::Capacity)?;
        let scope = StreamScope {
            page,
            epoch: epoch.parse().map_err(|_| Fault::Invalid)?,
            stream: &stream,
        };
        stream_inventory(c, scope, epoch == current, &mut out)?;
    }
    let baseline = sequence(current.parse().map_err(|_| Fault::Invalid)?);
    let mut baselines = c.prepare("SELECT epoch,length(envelope) FROM baselines WHERE page=?1")?;
    let baselines = baselines
        .query_map([page], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (epoch, bytes) in baselines {
        let bytes = u64::try_from(bytes).map_err(|_| Fault::Invalid)?;
        if epoch == baseline {
            out.baseline_current.add(bytes)?;
        } else {
            out.baseline_old.add(bytes)?;
        }
    }
    Ok(out)
}

fn stream_inventory(
    c: &Connection,
    s: StreamScope<'_>,
    active: bool,
    out: &mut ContentInventory,
) -> StoreResult<()> {
    let epoch = s.epoch.to_string();
    let latest = paired(c, s)?.map(sequence);
    let confirmed: Option<String> = c
        .query_row(
            "SELECT confirmed_seq FROM cloud_publications WHERE page=?1 AND epoch=?2 AND stream=?3",
            params![s.page, epoch, s.stream],
            |r| r.get(0),
        )
        .optional()?;
    // Exactly the prune candidates: only a current stream with an active tail and a paired cut.
    let bounds = match &latest {
        Some(latest) if active && has_active_tail(c, s)? => prune_bounds(c, s, latest)?,
        _ => None,
    };
    let anchored = match &latest {
        Some(latest) => c.query_row(
            "SELECT EXISTS(SELECT 1 FROM checkpoints WHERE page=?1 AND epoch=?2 AND stream=?3 AND seq=?4
             AND signer IS NOT NULL AND payload IS NOT NULL)",
            params![s.page, epoch, s.stream, latest],
            |r| r.get(0),
        )?,
        None => false,
    };
    let (cut, bound_latest, bound_anchored) = bounds.as_ref().map_or((None, None, false), |b| {
        (Some(b.cut.clone()), Some(b.latest.clone()), b.anchored)
    });
    let receipts = format!(
        "SELECT seq, length(payload), ?4 IS NOT NULL AND ({RECEIPT_CANDIDATES_AT})
         FROM receipts WHERE page=?1 AND epoch=?2 AND stream=?3 AND namespace='content'",
        RECEIPT_CANDIDATES_AT = RECEIPT_CANDIDATES
    );
    let mut rows = Vec::new();
    let mut query = c.prepare(&receipts)?;
    let found = query.query_map(
        params![s.page, epoch, s.stream, cut, bound_latest, bound_anchored],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, bool>(2)?,
            ))
        },
    )?;
    for row in found {
        let (seq, bytes, candidate) = row?;
        out.receipt_rows = out.receipt_rows.checked_add(1).ok_or(Fault::Capacity)?;
        let Some(bytes) = bytes else {
            out.pruned_receipt_rows = out
                .pruned_receipt_rows
                .checked_add(1)
                .ok_or(Fault::Capacity)?;
            continue;
        };
        let signed = anchored && latest.as_deref() == Some(seq.as_str());
        rows.push(Row {
            checkpoint: false,
            seq,
            signed,
            pinned: false,
            candidate,
            bytes: u64::try_from(bytes).map_err(|_| Fault::Invalid)?,
        });
    }
    let checkpoints = format!(
        "SELECT seq, length(payload), signer IS NOT NULL, pinned<>0, ?4 IS NOT NULL AND ({CHECKPOINT_CANDIDATES})
         FROM checkpoints WHERE page=?1 AND epoch=?2 AND stream=?3 AND namespace='content' AND payload IS NOT NULL"
    );
    let mut query = c.prepare(&checkpoints)?;
    let found = query.query_map(params![s.page, epoch, s.stream, bound_latest], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, bool>(2)?,
            r.get::<_, bool>(3)?,
            r.get::<_, bool>(4)?,
        ))
    })?;
    for row in found {
        let (seq, bytes, signed, pinned, candidate) = row?;
        rows.push(Row {
            checkpoint: true,
            seq,
            signed,
            pinned,
            candidate,
            bytes: u64::try_from(bytes).map_err(|_| Fault::Invalid)?,
        });
    }
    // Own payloads are never candidates; count them apart.
    let own: (i64, i64) = c.query_row(
        "SELECT (SELECT count(*) FROM receipts WHERE page=?1 AND epoch=?2 AND stream=?3 AND namespace='own' AND payload IS NOT NULL)
              + (SELECT count(*) FROM checkpoints WHERE page=?1 AND epoch=?2 AND stream=?3 AND namespace='own' AND payload IS NOT NULL),
                COALESCE((SELECT sum(length(payload)) FROM receipts WHERE page=?1 AND epoch=?2 AND stream=?3 AND namespace='own'),0)
              + COALESCE((SELECT sum(length(payload)) FROM checkpoints WHERE page=?1 AND epoch=?2 AND stream=?3 AND namespace='own'),0)",
        params![s.page, epoch, s.stream],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    out.own.rows = out
        .own
        .rows
        .checked_add(u64::try_from(own.0).map_err(|_| Fault::Invalid)?)
        .ok_or(Fault::Capacity)?;
    out.own.bytes = out
        .own
        .bytes
        .checked_add(u64::try_from(own.1).map_err(|_| Fault::Invalid)?)
        .ok_or(Fault::Capacity)?;
    for row in rows {
        let reasons = reasons(&row, active, latest.as_deref(), confirmed.as_deref());
        let first = *reasons.first().ok_or(Fault::Invalid)?;
        out.reasons.entry(first).or_default().add(row.bytes)?;
        if reasons.len() > 1 {
            let key = reasons
                .iter()
                .map(|reason| {
                    serde_json::to_value(reason)
                        .ok()
                        .and_then(|v| v.as_str().map(str::to_owned))
                })
                .collect::<Option<Vec<_>>>()
                .ok_or(Fault::Invalid)?
                .join("+");
            out.overlaps.entry(key).or_default().add(row.bytes)?;
        }
    }
    Ok(())
}

/// Every reason that keeps a payload, first one first. What `prune` removes is a candidate and
/// nothing else, so the estimate equals the current rules exactly.
fn reasons(row: &Row, active: bool, latest: Option<&str>, confirmed: Option<&str>) -> Vec<Reason> {
    if row.candidate {
        return vec![Reason::PruneableNow];
    }
    let mut reasons = Vec::new();
    if !active {
        reasons.push(Reason::OldEpoch);
    }
    // A superseded fold is pruned like any checkpoint; only the one at the cut binds anything.
    if row.signed && latest == Some(row.seq.as_str()) {
        reasons.push(Reason::OwnerSigned);
    }
    if row.pinned {
        reasons.push(Reason::Pinned);
    }
    // Without a paired cut the page is rebuilt from its updates; a checkpoint there proves nothing.
    let Some(latest) = latest else {
        reasons.push(if row.checkpoint {
            Reason::Unknown
        } else {
            Reason::Bootstrap
        });
        return reasons;
    };
    let seq = row.seq.as_str();
    if row.checkpoint && seq == latest {
        reasons.push(Reason::LatestPaired);
    }
    if !row.checkpoint && confirmed.is_some_and(|confirmed| seq > confirmed && seq <= latest) {
        reasons.push(Reason::Unconfirmed);
    }
    if seq > latest {
        reasons.push(Reason::Bootstrap);
    }
    if reasons.is_empty() {
        reasons.push(Reason::Superseded);
    }
    reasons
}
