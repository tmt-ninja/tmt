//! The `talks` and `routes` views (#4892): the same facts and rules talk admission uses,
//! read at one instant. No effects.
use super::{OrchReadFailure, OrchZone, wire};
use crate::storage::{OrchTalkPair, Storage, orchestration_active_leads};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use tmt_core::orchestration::{sending::*, *};

/// Held entries shown per pair; `heldCount` gives the total.
const HELD_SHOWN: usize = 20;

struct Selection {
    snapshot: OrchSnapshot,
    selected: Vec<String>,
    zone: OrchZone,
}
impl Selection {
    fn load(storage: &Storage, member_query: Option<&str>) -> Result<Self, OrchReadFailure> {
        let all = storage.orchestration_snapshot(None)?;
        let selected = match member_query {
            Some(_) => {
                storage
                    .orchestration_snapshot(member_query)?
                    .snapshot
                    .identities
            }
            None => all.snapshot.identities.clone(),
        };
        Ok(Self {
            zone: OrchZone::load(all.time_zone.as_deref())?,
            snapshot: all.snapshot,
            selected: selected.into_iter().map(|i| i.id).collect(),
        })
    }
    fn name(&self, id: &str) -> Option<&str> {
        self.snapshot
            .identities
            .iter()
            .find(|i| i.id == id)
            .map(|i| i.name.as_str())
    }
    fn effective(&self, id: &str, at: u64) -> Result<OrchEffective, OrchError> {
        effective(&self.snapshot, id, at, &self.zone)
    }
    fn grant(&self, from: &str, to: &str, at: u64) -> Option<&OrchRouteGrant> {
        self.snapshot
            .route_grants
            .iter()
            .find(|g| g.from_id == from && g.to_id == to && at < g.until_ms)
    }
}

/// Page a key-ordered list after an opaque cursor (the last key of the previous page).
fn page<T>(
    items: Vec<(String, T)>,
    limit: Option<u16>,
    after: Option<&str>,
) -> (Vec<T>, Option<String>) {
    let limit = usize::from(limit.unwrap_or(wire::ORCH_PAGE_MAX));
    let mut rest: Vec<_> = items
        .into_iter()
        .filter(|(key, _)| after.is_none_or(|a| key.as_str() > a))
        .collect();
    let next = (rest.len() > limit).then(|| rest[limit - 1].0.clone());
    rest.truncate(limit);
    (rest.into_iter().map(|(_, v)| v).collect(), next)
}

fn held_value(s: &Selection, held: &OrchHeld, at: u64) -> Value {
    json!({"requestId":held.request_id,"from":held.from_id,"fromName":s.name(&held.from_id),"to":held.to_id,"toName":s.name(&held.to_id),"createdAtMs":held.held_ms,"expiresAtMs":held.expires_at_ms,"state":if at < held.expires_at_ms {"held"} else {"expired_unsent"}})
}

pub(super) fn talks(
    storage: &Storage,
    member_query: Option<&str>,
    limit: Option<u16>,
    after: Option<&str>,
    at: u64,
) -> Result<Value, OrchReadFailure> {
    let s = Selection::load(storage, member_query)?;
    let known = |id: &str| s.name(id).is_some();
    let chosen = |id: &str| s.selected.iter().any(|m| m == id);
    let mut rows = Vec::new();
    for pair in storage.orchestration_talks(at)? {
        let OrchTalkPair {
            first_id,
            second_id,
            count,
            last_at_ms,
            window_start_ms,
            held,
        } = pair;
        // The user person and retired identities are not agents in this view.
        if !known(&first_id) || !known(&second_id) || !(chosen(&first_id) || chosen(&second_id)) {
            continue;
        }
        let first = s.effective(&first_id, at)?;
        let second = s.effective(&second_id, at)?;
        let member = |id: &str, e: &OrchEffective| json!({"identityId":id,"name":s.name(id),"talkLimit":wire::effective_value(e)["talkLimit"]});
        let live = held.iter().any(|h| at < h.expires_at_ms);
        let shown: Vec<_> = held
            .iter()
            .take(HELD_SHOWN)
            .map(|h| held_value(&s, h, at))
            .collect();
        rows.push((
            format!("{first_id}:{second_id}"),
            json!({"members":[member(&first_id,&first),member(&second_id,&second)],"count":count,"limit":pair_limit(first.talk_limit.value,second.talk_limit.value),"lastAtMs":last_at_ms,"windowStartMs":window_start_ms,"state":if live {"held"} else {"open"},"heldCount":held.len(),"held":shown}),
        ));
    }
    let (pairs, next) = page(rows, limit, after);
    let active = orchestration_active_leads(&s.snapshot);
    let leads: Vec<_> = s
        .snapshot
        .leads
        .iter()
        .map(|id| json!({"identityId":id,"name":s.name(id),"retired":!active.contains(&id.as_str())}))
        .collect();
    let grants: Vec<_> = s
        .snapshot
        .route_grants
        .iter()
        .filter(|g| at < g.until_ms)
        .map(|g| json!({"from":g.from_id,"to":g.to_id,"untilMs":g.until_ms,"grantedBy":g.granted_by}))
        .collect();
    Ok(
        json!({"schemaVersion":1,"configurationRevision":s.snapshot.revision,"observedAtMs":at,"windowMs":ORCH_TALK_WINDOW_MS,"leads":leads,"pairs":pairs,"nextAfter":next,"routeGrants":grants}),
    )
}

pub(super) fn routes(
    storage: &Storage,
    member_query: Option<&str>,
    limit: Option<u16>,
    after: Option<&str>,
    at: u64,
) -> Result<Value, OrchReadFailure> {
    let s = Selection::load(storage, member_query)?;
    if s.selected.len() > usize::from(wire::ORCH_PAGE_MAX) {
        return Err(OrchError::Limit.into());
    }
    let leads = orchestration_active_leads(&s.snapshot);
    let counts: BTreeMap<_, _> = storage
        .orchestration_talks(at)?
        .into_iter()
        .map(|p| ((p.first_id, p.second_id), p.count))
        .collect();
    let effective: BTreeMap<_, _> = s
        .selected
        .iter()
        .map(|id| Ok((id.as_str(), s.effective(id, at)?)))
        .collect::<Result<_, OrchError>>()?;
    let mut rows = Vec::new();
    for (from, sender) in &effective {
        for (to, recipient) in &effective {
            if from == to {
                continue;
            }
            let grant = s.grant(from, to, at).map(|g| g.until_ms);
            let (verdict, source) = match route(&sender.sending, leads.contains(to), grant, at) {
                OrchRoute::Restricted { source, .. } => ("blocked", wire::source_value(&source)),
                OrchRoute::Granted { until_ms } => {
                    ("allowed", json!({"kind":"grant","grantUntilMs":until_ms}))
                }
                OrchRoute::Allowed => {
                    let limit = pair_limit(sender.talk_limit.value, recipient.talk_limit.value);
                    let key = if from < to {
                        (*from, *to)
                    } else {
                        (*to, *from)
                    };
                    let counted = counts
                        .get(&(key.0.to_owned(), key.1.to_owned()))
                        .copied()
                        .unwrap_or(0);
                    if !leads.contains(from) && needs_person(counted, limit) {
                        // The smaller limit decides; its source explains the verdict.
                        let decider = if recipient.talk_limit.value == limit {
                            recipient
                        } else {
                            sender
                        };
                        (
                            "needs_person",
                            wire::source_value(&decider.talk_limit.source),
                        )
                    } else {
                        ("allowed", wire::source_value(&sender.sending.source))
                    }
                }
            };
            rows.push((
                format!("{from}:{to}"),
                json!({"from":from,"fromName":s.name(from),"to":to,"toName":s.name(to),"verdict":verdict,"source":source}),
            ));
        }
    }
    let (routes, next) = page(rows, limit, after);
    Ok(
        json!({"schemaVersion":1,"configurationRevision":s.snapshot.revision,"observedAtMs":at,"routes":routes,"nextAfter":next}),
    )
}
