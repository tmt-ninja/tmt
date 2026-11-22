//! Self-compaction of the local writer's own stream (#1627). The device merges only its own
//! verified updates into one checkpoint per namespace at the stream's current head, so a page
//! edited many times by this device keeps a short tail. Other devices' streams are never touched,
//! and the shared document is never re-encoded: the merge is `merge_updates_v1` of this stream's
//! updates inside the isolated decoder. Eligible current-history content may instead GC-encode
//! that writer's self-contained document, preserving its client clocks; never the shared document.
use super::{
    Fault, PageUsage, hex,
    owner_fold::{self, Folded, Left},
    snapshot,
};
use crate::{
    Result,
    decoder::Decoder,
    keyring::Keyring,
    store::{Envelope, Fault as StoreFault, Namespace, Store, StreamScope},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tmt_colab_model::{crypto, object};

/// A device compacts its own stream once this many updates sit after its last checkpoint.
pub const TRIGGER_UPDATES: usize = 50;
/// ...or once their plaintext adds up to this many bytes.
pub const TRIGGER_BYTES: usize = 1024 * 1024;

/// Whether a page has enough retained content tail for an automatic history pass. Own records
/// alone never trigger history GC, and the existing admission snapshot supplies the policy.
pub(crate) fn history_due(
    store: &Store,
    key: &Keyring,
    page: &str,
    trigger: Trigger,
) -> Result<bool> {
    let s = snapshot(store, key, page, true)?;
    if !s.authority.policy.history_current || s.authority.policy.public_mode {
        return Ok(false);
    }
    let mut count = 0;
    let mut bytes = 0;
    for (index, object) in &s.objects {
        if s.cuts[*index].namespace == "content" && !object.checkpoint {
            count += 1;
            bytes += object.bytes.len() / 4 * 3;
        }
    }
    Ok(count > 0 && (count >= trigger.updates || bytes >= trigger.bytes))
}

/// One namespace of one original writer, under the page's authenticated retention policy.
/// Own records retain ordinary merge semantics; shared-history and public content is not rebuilt.
pub(super) fn checkpoint_updates(
    decoder: &mut Decoder,
    namespace: Namespace,
    updates: &[&[u8]],
    policy: &crate::fold::PagePolicy,
) -> Result<Vec<u8>> {
    if namespace == Namespace::Content && policy.history_current && !policy.public_mode {
        Ok(decoder.rebuild_content(updates, None)?)
    } else {
        Ok(decoder.merge(namespace, updates, None)?)
    }
}

/// When a device's own tail is long enough to combine, and until when it may still publish.
#[derive(Clone, Copy)]
pub struct Trigger {
    pub updates: usize,
    pub bytes: usize,
    /// A combine that is still working at this instant publishes nothing, so a caller that
    /// answers by then never sees the page change after its answer.
    pub until: Option<std::time::Instant>,
}
impl Trigger {
    pub(crate) fn late(&self) -> bool {
        self.until
            .is_some_and(|until| std::time::Instant::now() >= until)
    }
}
impl Default for Trigger {
    fn default() -> Self {
        Self {
            updates: TRIGGER_UPDATES,
            bytes: TRIGGER_BYTES,
            until: None,
        }
    }
}

/// What one compaction published.
#[derive(Debug, PartialEq, Eq)]
pub struct Compacted {
    /// The shared stream position the checkpoints cover (1..=through).
    pub through: u64,
    /// Updates (and earlier checkpoints) merged away, over both namespaces.
    pub merged_objects: usize,
    /// Namespaces that now have a checkpoint at `through`.
    pub namespaces: usize,
}

/// Finish a deferred native content write's combine, never a cold creation or another
/// writer's tail. The offline caller holds its lifecycle lock through the next preparation.
pub fn deferred_write(
    store: &mut Store,
    key: &Keyring,
    page: &str,
    decoder: &mut Decoder,
) -> Result<Option<Compacted>> {
    let (stream, ..) = key.local_writer()?;
    let epoch = store.owner_read(&key.space_id, &key.owner_public(), |tx| {
        tx.current_epoch(page)
    })?;
    // Reuse bootstrap's paired-prefix selection; a lone namespace checkpoint is
    // not evidence that a previous write's combine finished.
    let checkpoint = store
        .namespace_next(
            StreamScope {
                page,
                epoch,
                stream: &stream,
            },
            crate::store::Namespace::Content,
            crate::store::NamespaceCursor::default(),
        )?
        .filter(|object| object.checkpoint)
        .map_or(0, |object| object.cursor.seq);
    let pending = store.owner_read(&key.space_id, &key.owner_public(), |tx| {
        tx.uncombined_content_write(page, epoch, &stream, checkpoint)
    })?;
    if !pending {
        return Ok(None);
    }
    compact(store, key, page, decoder, Trigger::default())
}

/// Combine the local writer's own stream if its tail passed `trigger`. Safe to repeat: a
/// checkpoint that already exists at the head is kept, and a crash between the two namespaces
/// leaves data intact (an unpaired checkpoint prunes nothing) and is completed by the next call.
pub fn compact(
    store: &mut Store,
    key: &Keyring,
    page: &str,
    decoder: &mut Decoder,
    trigger: Trigger,
) -> Result<Option<Compacted>> {
    let s = snapshot(store, key, page, true)?;
    let (id, _, _) = key.local_writer()?;
    let own: Vec<usize> = (0..s.cuts.len())
        .filter(|index| s.cuts[*index].stream == id)
        .collect();
    let head = own
        .iter()
        .map(|index| s.cuts[*index].tail_seq)
        .max()
        .unwrap_or(0);
    if head == 0 {
        return Ok(None);
    }
    let Some(head_hash) = own
        .iter()
        .map(|index| &s.cuts[*index])
        .find(|cut| cut.tail_seq == head)
        .map(|cut| cut.tail_hash)
    else {
        return Ok(None);
    };
    // The tail this device would combine: its objects after each namespace's checkpoint.
    let mut tail_updates = 0;
    let mut tail_bytes = 0;
    for (index, stored) in &s.objects {
        if own.contains(index) && !stored.checkpoint {
            tail_updates += 1;
            tail_bytes += stored.bytes.len() / 4 * 3;
        }
    }
    if tail_updates == 0 || (tail_updates < trigger.updates && tail_bytes < trigger.bytes) {
        return Ok(None);
    }
    let scope = StreamScope {
        page,
        epoch: s.epoch,
        stream: &id,
    };
    let mut namespaces = 0;
    let mut pending = Vec::new();
    for (name, namespace) in [("content", Namespace::Content), ("own", Namespace::Own)] {
        let Some(cut_index) = own.iter().copied().find(|i| s.cuts[*i].namespace == name) else {
            continue;
        };
        if s.cuts[cut_index].checkpoint_seq == head {
            namespaces += 1;
            continue;
        }
        let objects: Vec<_> = s.objects.iter().filter(|(i, _)| *i == cut_index).collect();
        if objects.is_empty() {
            continue;
        }
        let mut plaintexts = Vec::with_capacity(objects.len());
        for (index, stored) in &objects {
            plaintexts.push(s.open_object(key, page, *index, stored)?.plaintext);
        }
        let refs = plaintexts.iter().map(Vec::as_slice).collect::<Vec<_>>();
        let merged = checkpoint_updates(decoder, namespace, &refs, &s.authority.policy)?;
        if merged.len() > object::MAX_PLAINTEXT {
            // Too large to carry as one object; leave the stream as it is.
            return Ok(None);
        }
        pending.push((name, namespace, cut_index, objects.len(), merged));
        namespaces += 1;
        if trigger.late() {
            return Ok(None);
        }
    }
    if namespaces == 0 {
        return Err(Fault::Missing.into());
    }
    if !pending.is_empty() {
        // A merge can be valid update-v1 yet omit or change content. Compare every projection
        // before the first checkpoint can make a paired prefix eligible for pruning.
        let current = s.materialize(key, page, decoder)?;
        if trigger.late() {
            return Ok(None);
        }
        let replacements = pending
            .iter()
            .map(|(_, _, index, _, merged)| (*index, merged.clone()))
            .collect::<BTreeMap<_, _>>();
        let candidate = match s.materialize_with_replacements(key, page, decoder, &replacements) {
            Ok(candidate) => candidate,
            Err(_) => return Ok(None),
        };
        if current.source != candidate.source
            || current.meta != candidate.meta
            || current.own != candidate.own
        {
            return Ok(None);
        }
    }
    // Everything above only read; from here the page changes.
    if trigger.late() {
        return Ok(None);
    }
    let mut merged_objects = 0;
    for (name, namespace, _, count, merged) in pending {
        let envelope = key.seal_content(
            &object::Context {
                space: key.space_id.clone(),
                page: page.into(),
                epoch: s.epoch.to_string(),
                kind: "checkpoint".into(),
                namespace: name.into(),
                author_device: id.clone(),
                membership_revision: s.authority.head.revision.to_string(),
                stream_seq: head.to_string(),
                prev_hash: head_hash,
            },
            &s.secret,
            &merged,
        )?;
        let published = store.checkpoint(&Envelope {
            scope,
            namespace,
            seq: head,
            hash: envelope.hash()?,
            previous: head_hash,
            bytes: &envelope.to_bytes()?,
        });
        match published {
            Ok(_) => {}
            // Another run already published this checkpoint; keep it.
            Err(StoreFault::Conflict | StoreFault::StaleCheckpoint) => {}
            Err(other) => return Err(other.into()),
        }
        merged_objects += count;
    }
    Ok(Some(Compacted {
        through: head,
        merged_objects,
        namespaces,
    }))
}

/// Why a requested compaction published nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Skipped {
    /// This device has no changes after its checkpoints; nothing to combine.
    NothingToCombine,
    /// This device has changes to combine, but the combine could not be published (the merge
    /// would be too large for one checkpoint, or it did not finish in time).
    NotCombined,
}

pub const SHARED_HISTORY: &str = "This page retains edit history for future collaborators. Combining changes keeps deleted text inside the checkpoint. Freeing those bytes would require explicitly discarding old content history.";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPreview {
    pub before_gzip_bytes: usize,
    pub after_gzip_bytes: Option<usize>,
    pub headroom_bytes: Option<usize>,
    pub estimated_whole_rewrites: Option<usize>,
    pub write_fits: Option<bool>,
    pub write_detail: String,
    pub blocked: Option<String>,
    pub history_loss: &'static str,
    pub changes_history_policy: Option<bool>,
    pub affected_recipients: Option<usize>,
    pub discard: Option<HistoryDiscard>,
}

/// Build and decode a hypothetical replacement without publishing a checkpoint.
pub fn preview(
    store: &Store,
    key: &Keyring,
    page: &str,
    decoder: &mut Decoder,
    source: Option<&str>,
) -> Result<HistoryPreview> {
    prepare_history_recovery(store, key, page, decoder, source).map(|(preview, _)| preview)
}

type RecoveryCandidate = (
    crate::fold::Snapshot,
    usize,
    Vec<u8>,
    crate::store::WriteGeneration,
);

fn prepare_history_recovery(
    store: &Store,
    key: &Keyring,
    page: &str,
    decoder: &mut Decoder,
    source: Option<&str>,
) -> Result<(HistoryPreview, Option<RecoveryCandidate>)> {
    let generation = store.write_generation()?;
    let snap = snapshot(store, key, page, false)?;
    let (current, _, before) = snap.measure_preview(key, page, decoder, &BTreeMap::new())?;
    let mut result = HistoryPreview {
        before_gzip_bytes: before,
        after_gzip_bytes: None,
        headroom_bytes: None,
        estimated_whole_rewrites: None,
        write_fits: None,
        write_detail:
            "Fit unknown. Supply the proposed HTML with --source FILE (or --source - for stdin)."
                .into(),
        blocked: None,
        history_loss: "Discarded content edits and deleted text in the rebuilt writer checkpoint would no longer be recoverable. Current source, metadata, comments and threads must be preserved.",
        changes_history_policy: None,
        affected_recipients: None,
        discard: None,
    };
    let policy = &snap.authority.policy;
    let local = key.local_writer()?.0;
    result.blocked = if !policy.writable() {
        Some("Page is archived or deleted.".into())
    } else if policy.public_mode || policy.link_mode {
        Some("Page has public or link access.".into())
    } else if store.history_cloud_bound(page)? {
        Some("A cloud page row or stream publication is recorded for this page. Local recovery cannot discard those dependencies.".into())
    } else if snap.epoch != 1 {
        Some(format!(
            "Epoch {} depends on an earlier baseline.",
            snap.epoch
        ))
    } else if current.meta.get("pageType").is_some() {
        Some("This preview supports HTML pages only.".into())
    } else if let Some((stream, seq)) = store.pinned_content_checkpoint(page)? {
        Some(format!(
            "Content checkpoint {stream} at sequence {seq} is pinned."
        ))
    } else if let Some(r) = snap
        .authority
        .recipients
        .values()
        .map(|issuer| &issuer.recipient)
        .find(|r| {
            r.id != snap.authority.head.owner_member.id
                && crate::fold::eligible(r, &snap.authority, page)
        })
    {
        Some(format!("Recipient {} still has access to this page.", r.id))
    } else {
        snap.cuts
            .iter()
            .find(|cut| cut.namespace == "content" && cut.stream != local && cut.tail_seq > 0)
            .map(|cut| format!("Content from writer {} must be preserved.", cut.stream))
    };
    if result.blocked.is_some() {
        return Ok((result, None));
    }
    let mut updates = Vec::new();
    let mut index = None;
    for (i, object) in &snap.objects {
        if snap.cuts[*i].namespace == "content" && snap.cuts[*i].stream == local {
            updates.push(snap.open_object(key, page, *i, object)?.plaintext);
            index = Some(*i);
        }
    }
    let Some(index) = index else {
        result.blocked = Some("No local content writer to rebuild.".into());
        return Ok((result, None));
    };
    let refs = updates.iter().map(Vec::as_slice).collect::<Vec<_>>();
    let rebuilt = decoder.rebuild_for_preview(&refs, None)?;
    if !rebuilt.projection.is_null() {
        result.blocked =
            Some("This writer's updates depend on content outside its own stream.".into());
        return Ok((result, None));
    }
    let merged = rebuilt.merged;
    if merged.len() > object::MAX_PLAINTEXT {
        result.blocked = Some("The rebuilt writer exceeds the single checkpoint limit.".into());
        return Ok((result, None));
    }
    let mut replacement = BTreeMap::from([(index, merged)]);
    let (candidate, input, after) = snap.measure_preview(key, page, decoder, &replacement)?;
    if current.source != candidate.source
        || current.meta != candidate.meta
        || current.own != candidate.own
    {
        result.blocked = Some("Rebuilding changes the current page or its discussion.".into());
        return Ok((result, None));
    }
    if after > current.usage.gzip_limit {
        result.blocked = Some("The rebuilt page still exceeds the compressed page limit.".into());
        return Ok((result, None));
    }
    let headroom = current.usage.gzip_limit.saturating_sub(after);
    result.after_gzip_bytes = Some(after);
    result.headroom_bytes = Some(headroom);
    if !current.source.is_empty() {
        result.estimated_whole_rewrites =
            Some(headroom / crate::fold::gzip_bytes(std::iter::once(current.source.as_bytes()))?);
    }
    if let Some(source) = source {
        let base = super::PatchBase {
            revision: String::new(),
            source: candidate.source,
            meta: candidate.meta,
            input,
        };
        let edit = crate::decoder::ContentEdit {
            source,
            publisher_agent: None,
            layout: None,
            attachments: None,
        };
        match snap.prepare_content_batch(
            key,
            page,
            edit,
            None,
            crate::fold::Held {
                base: Some(&base),
                checked: None,
            },
            decoder,
        ) {
            Ok(_) => {
                result.write_fits = Some(true);
                result.write_detail = "The supplied source fits the candidate.".into();
            }
            Err(error) => {
                if matches!(
                    error.downcast_ref::<crate::store::owner::OwnerFault>(),
                    Some(
                        crate::store::owner::OwnerFault::PageCapacity(_)
                            | crate::store::owner::OwnerFault::Capacity
                    )
                ) {
                    result.write_fits = Some(false);
                }
                result.write_detail = format!("The supplied write could not be prepared: {error}");
            }
        }
    }
    let cut = &snap.cuts[index];
    result.discard = Some(store.owner_read(&key.space_id, &key.owner_public(), |tx| {
        tx.history_discard_size(
            StreamScope {
                page,
                epoch: cut.epoch,
                stream: &cut.stream,
            },
            cut.tail_seq,
        )
    })?);
    result.changes_history_policy = Some(!policy.history_current);
    result.affected_recipients = Some(0);
    if store.write_generation()? != generation {
        return Err(Fault::StaleBase.into());
    }
    let merged = replacement.remove(&index).ok_or(Fault::Invalid)?;
    Ok((result, Some((snap, index, merged, generation))))
}

/// Sealed local content payloads replaced by a confirmed recovery.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDiscard {
    pub checkpoints: u64,
    pub checkpoint_bytes: u64,
    pub updates: u64,
    pub update_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecovery {
    pub page: String,
    pub discarded: HistoryDiscard,
    pub before_gzip_bytes: usize,
    pub after_gzip_bytes: Option<usize>,
    pub freed_gzip_bytes: Option<usize>,
    pub measurement_error: Option<String>,
}

/// Owner-only implementation. The caller holds the local writer lifecycle lock or
/// runs inside serve. `announce` reports the exact staged loss before any write.
pub fn discard_history(
    store: &mut Store,
    key: &Keyring,
    page: &str,
    operation_id: &str,
    decoder: &mut Decoder,
    announce: impl FnOnce(&HistoryPreview, &HistoryDiscard) -> Result<()>,
) -> Result<HistoryRecovery> {
    let (mut preview, candidate) = prepare_history_recovery(store, key, page, decoder, None)?;
    let (snapshot, index, merged, generation) = candidate.ok_or_else(|| {
        std::io::Error::other(
            preview
                .blocked
                .as_deref()
                .unwrap_or("History recovery is unavailable."),
        )
    })?;
    if preview
        .after_gzip_bytes
        .is_none_or(|after| after >= preview.before_gzip_bytes)
    {
        return Err(
            std::io::Error::other("This recovery would not reduce stored page usage.").into(),
        );
    }

    let cut = &snapshot.cuts[index];
    let scope = StreamScope {
        page,
        epoch: cut.epoch,
        stream: &cut.stream,
    };
    let next = cut.tail_seq.checked_add(1).ok_or(Fault::Capacity)?;
    let discard = preview.discard.take().ok_or(Fault::Invalid)?;
    let payload = serde_json::to_vec(&serde_json::json!({"pageId":page,"mode":"current"}))?;
    let decision = key.sign_statement(Some(&snapshot.authority.head), "page.history", &payload)?;
    let revision = snapshot
        .authority
        .head
        .revision
        .checked_add(1)
        .ok_or(Fault::Capacity)?;
    let mut context = object::Context {
        space: key.space_id.clone(),
        page: page.into(),
        epoch: cut.epoch.to_string(),
        kind: "update".into(),
        namespace: "content".into(),
        author_device: cut.stream.clone(),
        membership_revision: revision.to_string(),
        stream_seq: next.to_string(),
        prev_hash: cut.tail_hash,
    };
    // An empty update-v1 advances the signed stream with no document or activity change.
    let anchor = key.seal_content(&context, &snapshot.secret, &[0, 0])?;
    let anchor_hash = anchor.hash()?;
    let anchor_bytes = anchor.to_bytes()?;
    context.kind = "checkpoint".into();
    context.prev_hash = anchor_hash;
    let content = key.seal_content(&context, &snapshot.secret, &merged)?;
    let content_bytes = content.to_bytes()?;
    let mut checkpoints = vec![Envelope {
        scope,
        namespace: Namespace::Content,
        seq: next,
        hash: content.hash()?,
        previous: anchor_hash,
        bytes: &content_bytes,
    }];
    let own_bytes;
    if let Some(own_index) = snapshot
        .cuts
        .iter()
        .position(|own| own.stream == cut.stream && own.namespace == "own" && own.tail_seq > 0)
    {
        let current = snapshot.materialize(key, page, decoder)?;
        let own = current.local_own_update.as_ref().ok_or(Fault::Invalid)?;
        let (candidate, _, after) = snapshot.measure_preview(
            key,
            page,
            decoder,
            &BTreeMap::from([(index, merged), (own_index, own.clone())]),
        )?;
        if after > current.usage.gzip_limit || after >= preview.before_gzip_bytes {
            return Err(Fault::Capacity.into());
        }
        if candidate.source != current.source
            || candidate.meta != current.meta
            || candidate.own != current.own
        {
            return Err(Fault::Invalid.into());
        }
        context.namespace = "own".into();
        let checkpoint = key.seal_content(&context, &snapshot.secret, own)?;
        own_bytes = checkpoint.to_bytes()?;
        checkpoints.push(Envelope {
            scope,
            namespace: Namespace::Own,
            seq: next,
            hash: checkpoint.hash()?,
            previous: anchor_hash,
            bytes: &own_bytes,
        });
    }
    store.owner_transaction(
        &key.space_id,
        &key.owner_public(),
        crate::store::owner::Mutation {
            operation_id,
            digest: decision.hash()?,
            expected_revision: snapshot.authority.head.revision,
        },
        |tx| {
            if tx.write_generation()? != generation
                || tx.head() != Some(&snapshot.authority.head)
                || tx.cuts(page, scope.epoch)? != snapshot.cuts
                || tx.history_discard_size(scope, cut.tail_seq)? != discard
            {
                return Err(Fault::StaleBase.into());
            }
            announce(&preview, &discard)?;
            tx.append_statement(&decision)?;
            tx.stage_history_recovery(
                &Envelope {
                    scope,
                    namespace: Namespace::Content,
                    seq: next,
                    hash: anchor_hash,
                    previous: cut.tail_hash,
                    bytes: &anchor_bytes,
                },
                &checkpoints,
            )?;
            Ok(serde_json::to_vec(&discard)?)
        },
    )?;
    // This read is deliberately after commit. A read failure cannot undo the recovery or
    // turn the preview into a claim about actual freed space.
    let measured = (|| -> Result<usize> {
        let committed = super::snapshot(store, key, page, false)?;
        let (_, _, bytes) = committed.measure_preview(key, page, decoder, &BTreeMap::new())?;
        Ok(bytes)
    })();
    let (after_gzip_bytes, measurement_error) = match measured {
        Ok(bytes) => (Some(bytes), None),
        Err(error) => (None, Some(error.to_string())),
    };
    Ok(HistoryRecovery {
        page: page.into(),
        discarded: discard,
        before_gzip_bytes: preview.before_gzip_bytes,
        after_gzip_bytes,
        freed_gzip_bytes: after_gzip_bytes
            .map(|after| preview.before_gzip_bytes.saturating_sub(after)),
        measurement_error,
    })
}

/// What a requested compaction did, for the person who asked: whose stream was combined into
/// which range, the page's usage before and after, and the source hash that did not change.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    pub page_id: String,
    pub compacted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped: Option<Skipped>,
    /// The device whose own stream was combined: this one.
    pub by: String,
    /// The range of that stream the checkpoints now hold: 1..=through (0 when nothing was combined).
    pub through: u64,
    /// Changes merged away, in this device's stream and in the streams folded below.
    pub merged_objects: usize,
    /// Other devices' streams combined into owner folds, each with the range it now covers.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folded: Vec<Folded>,
    /// Streams with changes this run left as they are, each with the reason.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub left: Vec<Left>,
    /// Streams with changes this run did not reach; running it again continues.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub unfolded: usize,
    pub source_sha256: String,
    pub before: PageUsage,
    pub after: PageUsage,
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

/// Combine this device's own stream now, whatever the size of its tail, then fold the streams of
/// other owner-member devices (`owner_fold`), and report what changed. Each step compares every
/// projection of the merge with the page's own before its first checkpoint, so the source is the
/// same before and after or nothing is published. Repeating it finds no tail and is a no-op.
/// `after` shows what remains: streams no fold can combine are named in `left`.
pub fn request(
    store: &mut Store,
    key: &Keyring,
    page: &str,
    decoder: &mut Decoder,
    until: Option<std::time::Instant>,
) -> Result<Report> {
    let by = key.local_writer()?.0;
    let usage_before = snapshot(store, key, page, true)?.usage(key, page, decoder)?;
    let trigger = Trigger {
        updates: 1,
        bytes: usize::MAX,
        until,
    };
    let done = compact(store, key, page, decoder, trigger)?;
    let folds = owner_fold::fold_others(store, key, page, decoder, trigger)?;
    let after = snapshot(store, key, page, true)?;
    let usage_after = after.usage(key, page, decoder)?;
    let source_sha256 = hex(&crypto::digest(
        after.materialize(key, page, decoder)?.source.as_bytes(),
    ));
    let own_tail = usage_before.updates - usage_before.other_device_updates;
    let compacted = done.is_some() || !folds.folded.is_empty();
    // A device that only it can combine is no work left undone; the rest of what was left is.
    let unreached = folds
        .left
        .iter()
        .any(|left| left.why != owner_fold::Why::NotOwnerDevice)
        || folds.unfolded > 0;
    Ok(Report {
        page_id: page.into(),
        compacted,
        skipped: match (compacted, own_tail, unreached) {
            (true, ..) => None,
            (false, 0, false) => Some(Skipped::NothingToCombine),
            (false, ..) => Some(Skipped::NotCombined),
        },
        by,
        through: done.as_ref().map_or(0, |done| done.through),
        merged_objects: done.as_ref().map_or(0, |done| done.merged_objects)
            + folds.folded.iter().map(|f| f.merged_objects).sum::<usize>(),
        folded: folds.folded,
        left: folds.left,
        unfolded: folds.unfolded,
        source_sha256,
        before: usage_before,
        after: usage_after,
    })
}
