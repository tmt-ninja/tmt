//! Removal of attachment objects no retained reference reaches (#5284). The serve's
//! maintenance worker visits one page at a time: it lists the page's committed objects from
//! Remote, computes the reference set from the page itself, records when each listed object was
//! first seen unreferenced, and asks Remote to remove the ones unreferenced for
//! [`ATTACHMENT_UNREFERENCED_GRACE_MS`]. Only a definite `removed` answer forgets a clock; the
//! charge Remote reports drops when its release commits, before that answer.
//!
//! The reference set is every descriptor in the current page source and every message revision
//! of every readable epoch (deleted messages included, since their earlier revisions stay
//! readable), plus the objects of unfinished native attaches. Snapshot manifests join it when
//! they exist (#2299). Old-epoch document lists are not part of it: no reader can address them,
//! and removing a superseded rekeyed object ends its exposure window. Anything that cannot be
//! computed exactly decides nothing.
use crate::{
    Result,
    attachments::slots::StagingSlots,
    fold::Snapshot,
    limits::{
        ATTACHMENT_LIST_PAGES, ATTACHMENT_REMOVE_BATCH, ATTACHMENT_REQUEST,
        ATTACHMENT_UNREFERENCED_GRACE_MS,
    },
    object_channel::{
        ChannelOwner,
        namespace::{Listed, ObjectRemoval, removal_eligible},
    },
    page::{
        self,
        save::{Source, SourceOpener},
    },
    registration::OwnerAdmission,
    store::Store,
    sync::Server,
};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    time::Instant,
};

/// Epochs a root-local capture can still open, counting the current one.
const READABLE_EPOCHS: u64 = 64;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
/// The object IDs (lowercase hex) a list of descriptors names. A malformed entry still keeps
/// the object it names: this only ever widens what is kept.
fn descriptor_objects(list: Option<&Value>, into: &mut BTreeSet<String>) {
    for value in list.and_then(Value::as_array).into_iter().flatten() {
        if let Some(object) = value.get("objectId").and_then(Value::as_str) {
            into.insert(object.to_ascii_lowercase());
        }
    }
}

/// Every object a retained reference of `page` can reach. See the module comment.
pub(crate) fn references(
    view: &mut Source,
    slots: &StagingSlots,
    page: &str,
    deadline: Instant,
) -> Result<BTreeSet<String>> {
    let mut found = BTreeSet::new();
    let current = Snapshot::capture_read(&view.store, &view.keyring, page, None)?;
    let epoch = current.epoch;
    // An epoch older than the capture window cannot be read here, so the set would be
    // incomplete: decide nothing for such a page.
    if epoch > READABLE_EPOCHS {
        return Err(page::Fault::Unavailable.into());
    }
    let mut snapshots = vec![current];
    for old in (1..epoch).rev() {
        snapshots.push(Snapshot::capture_read(
            &view.store,
            &view.keyring,
            page,
            Some(old),
        )?);
    }
    for (index, snapshot) in snapshots.iter().enumerate() {
        if Instant::now() >= deadline {
            return Err(page::Fault::Unavailable.into());
        }
        let materialized =
            snapshot.materialize_until(&view.keyring, page, &mut view.decoder, deadline)?;
        if index == 0 {
            descriptor_objects(materialized.meta.get("attachments"), &mut found);
        }
        for roots in materialized.own.values() {
            for message in roots["messages"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(_, m)| m)
            {
                descriptor_objects(message.get("attachments"), &mut found);
            }
        }
    }
    found.extend(slots.in_flight_objects(page)?);
    Ok(found)
}

/// One pass's decisions for a page.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Plan {
    /// Clocks to forget: the object is referenced again, or no longer listed.
    pub forget: Vec<String>,
    /// Listed, unreferenced objects without a clock: theirs starts now.
    pub start: Vec<(String, u64)>,
    /// Listed, unreferenced objects whose grace has passed, in key order.
    pub due: Vec<Listed>,
}
/// Decide from the listing, the reference set and the recorded clocks. A clock in the future
/// (the wall clock moved back) is not due.
pub(crate) fn plan(
    listed: &[Listed],
    referenced: &BTreeSet<String>,
    clocks: &[(String, u64, u64)],
    now_ms: u64,
) -> Plan {
    let listed: BTreeMap<String, &Listed> = listed
        .iter()
        .map(|entry| (hex(entry.opaque_key.as_bytes()), entry))
        .collect();
    let clocks: BTreeMap<&str, u64> = clocks
        .iter()
        .map(|(object, _, since)| (object.as_str(), *since))
        .collect();
    let mut plan = Plan::default();
    for object in clocks.keys() {
        if referenced.contains(*object) || !listed.contains_key(*object) {
            plan.forget.push((*object).to_owned());
        }
    }
    for (object, entry) in &listed {
        if referenced.contains(object) {
            continue;
        }
        match clocks.get(object.as_str()) {
            None => plan.start.push((object.clone(), entry.payload_bytes)),
            Some(since) => {
                if since
                    .checked_add(ATTACHMENT_UNREFERENCED_GRACE_MS)
                    .is_some_and(|due| now_ms >= due)
                {
                    plan.due.push((*entry).clone());
                }
            }
        }
    }
    plan
}

/// What one page's pass did.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Visit {
    pub removed: usize,
    /// Something the next turn should look at again (a refusal, uncertainty or a full batch).
    pub unfinished: bool,
}

/// Visit one page. `now_ms` is the trusted wall clock; `deadline` bounds the whole visit.
pub(crate) fn visit(
    objects: &ChannelOwner,
    slots: &StagingSlots,
    source: &SourceOpener,
    sync: &Server<OwnerAdmission>,
    page: &str,
    now_ms: u64,
    deadline: Instant,
) -> Result<Visit> {
    let Some(client) = objects.client() else {
        return Ok(Visit {
            removed: 0,
            unfinished: true,
        });
    };
    // A Remote before version 4 cannot list: nothing is recorded or removed.
    if !objects.lists_objects() {
        return Ok(Visit::default());
    }
    let mut view = source()?;
    let layout = view.layout.clone();
    if !removal_eligible(&view, page)? {
        drop(view);
        let mut store = Store::write_existing(&layout)?;
        store.clear_unreferenced(page)?;
        store.close()?;
        return Ok(Visit::default());
    }
    // The fence is taken before anything is read, so any later write refuses the removal.
    let fence = view.store.page_fence(page)?;
    let request = |at: Instant| (at + ATTACHMENT_REQUEST).min(deadline);
    let Some(listed) =
        client.list_objects(page, source, ATTACHMENT_LIST_PAGES, request(Instant::now()))?
    else {
        return Ok(Visit::default());
    };
    let referenced = references(&mut view, slots, page, deadline)?;
    let clocks = view.store.unreferenced(page)?;
    drop(view);
    let plan = plan(&listed, &referenced, &clocks, now_ms);
    let mut store = Store::write_existing(&layout)?;
    store.update_unreferenced(page, &plan.forget, &plan.start, now_ms)?;
    let mut visit = Visit {
        removed: 0,
        unfinished: plan.due.len() > ATTACHMENT_REMOVE_BATCH,
    };
    for entry in plan.due.iter().take(ATTACHMENT_REMOVE_BATCH) {
        if Instant::now() >= deadline {
            visit.unfinished = true;
            break;
        }
        // Under the serve's write exclusion the fence cannot move while Remote decides.
        let outcome = sync.exclusive(|| {
            let current = source().is_ok_and(|view| {
                removal_eligible(&view, page).unwrap_or(false)
                    && view.store.page_fence(page).ok() == Some(fence)
            });
            if !current {
                return ObjectRemoval::Refused;
            }
            client.remove_object(page, source, entry, fence, request(Instant::now()))
        })?;
        match outcome {
            ObjectRemoval::Removed => {
                store.forget_unreferenced(page, &hex(entry.opaque_key.as_bytes()))?;
                visit.removed += 1;
            }
            // A moved fence or a refused original: the next turn computes again.
            ObjectRemoval::Refused | ObjectRemoval::Unknown | ObjectRemoval::Unavailable => {
                visit.unfinished = true;
                break;
            }
        }
    }
    store.close()?;
    Ok(visit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::object_channel::tests::listed_object;

    const DAY: u64 = 24 * 60 * 60 * 1000;
    fn listed(byte: u8, bytes: u64) -> Listed {
        listed_object([byte; 32], bytes)
    }
    fn object(byte: u8) -> String {
        hex(&[byte; 32])
    }

    #[test]
    fn an_unreferenced_listed_object_starts_its_clock_and_a_referenced_one_never_does() {
        let referenced = BTreeSet::from([object(1)]);
        let plan = plan(&[listed(1, 10), listed(2, 20)], &referenced, &[], 5);
        assert_eq!(plan.start, vec![(object(2), 20)]);
        assert!(plan.forget.is_empty() && plan.due.is_empty());
    }

    #[test]
    fn a_reference_again_or_a_vanished_object_forgets_the_clock() {
        let clocks = [(object(1), 10, 0), (object(2), 20, 0), (object(3), 30, 0)];
        // 1 is referenced again; 2 is no longer listed; 3 stays waiting.
        let plan = plan(
            &[listed(1, 10), listed(3, 30)],
            &BTreeSet::from([object(1)]),
            &clocks,
            DAY,
        );
        assert_eq!(plan.forget, vec![object(1), object(2)]);
        assert!(plan.start.is_empty() && plan.due.is_empty());
    }

    #[test]
    fn removal_waits_the_full_grace_and_a_clock_in_the_future_is_not_due() {
        let since = 1_000;
        let clocks = [(object(1), 10, since)];
        let grace = ATTACHMENT_UNREFERENCED_GRACE_MS;
        assert_eq!(grace, 30 * DAY);
        let none = BTreeSet::new();
        assert!(
            plan(&[listed(1, 10)], &none, &clocks, since + grace - 1)
                .due
                .is_empty()
        );
        assert_eq!(
            plan(&[listed(1, 10)], &none, &clocks, since + grace).due,
            vec![listed(1, 10)]
        );
        // The wall clock moved back before the clock started.
        assert!(
            plan(&[listed(1, 10)], &none, &clocks, since - 1)
                .due
                .is_empty()
        );
        // A clock that cannot overflow into an earlier due time.
        let late = [(object(1), 10, u64::MAX)];
        assert!(
            plan(&[listed(1, 10)], &none, &late, u64::MAX)
                .due
                .is_empty()
        );
    }

    #[test]
    fn descriptor_lists_widen_the_reference_set_even_when_malformed() {
        let mut found = BTreeSet::new();
        let upper = "AB".repeat(32);
        descriptor_objects(
            Some(&serde_json::json!([
                {"objectId": object(1)},
                {"objectId": upper, "filename": 3},
                {"noObject": true},
                "garbage"
            ])),
            &mut found,
        );
        descriptor_objects(None, &mut found);
        descriptor_objects(
            Some(&serde_json::json!({"objectId": object(9)})),
            &mut found,
        );
        assert_eq!(found, BTreeSet::from([object(1), "ab".repeat(32)]));
    }
}
