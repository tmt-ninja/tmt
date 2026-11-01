//! Strict local-owner request inspection protocol; never carries reply credentials.

use crate::request_runtime::valid_request_id;
use serde::Deserialize;
use serde_json::{Value, json};
use tmt_core::{
    dispatch::canonical_id,
    limits::MAX_JS_SAFE_INTEGER,
    request::{RequestPrompt, attention::FinalState, history::*},
};

pub const HISTORY_INPUT_LIMIT: usize = 4096;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CursorWire {
    prepared_at_ms: Option<u64>,
    submitted_at_ms: Option<u64>,
    answered_at_ms: Option<u64>,
    request_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QueryWire {
    originator_id: Option<String>,
    view: Option<String>,
    recipient_id: Option<String>,
    room_id: Option<String>,
    limit: Option<u64>,
    before: Option<CursorWire>,
    member_id: Option<String>,
    since: Option<String>,
}

/// What `requests.list` asks for: a history of one recipient or room, an originator's
/// results, an originator's answers, or the person's conversation with one member.
pub enum ListQuery {
    History(HistoryQuery),
    Answers(AnswersQuery),
    Conversation(ConversationInput),
}

/// The conversation view before the server resolves its viewer (#5807).
pub struct ConversationInput {
    pub member_id: String,
    pub limit: u64,
    pub before: Option<HistoryCursor>,
    pub since: Option<String>,
}
impl ConversationInput {
    pub fn query(self, viewer_id: String) -> ConversationQuery {
        let since = self
            .since
            .map(|since| decode_position(&since, &viewer_id, &self.member_id));
        ConversationQuery {
            since,
            viewer_id,
            member_id: self.member_id,
            limit: self.limit,
            before: self.before,
        }
    }
}

/// Positions are opaque to clients: `c1-<scope>-<viewer>-<member>-<retained>`, hex. The
/// scope tag lets a well-formed position from another viewer or member read as foreign.
fn scope_tag(viewer_id: &str, member_id: &str) -> String {
    tmt_core::content_digest::framed_sha256(
        b"tmt-conversation-position-v1",
        format!("{viewer_id}\n{member_id}").as_bytes(),
    )[..12]
        .to_owned()
}
pub fn encode_position(viewer_id: &str, member_id: &str, p: &ConversationPosition) -> String {
    format!(
        "c1-{}-{:x}-{:x}-{:x}",
        scope_tag(viewer_id, member_id),
        p.viewer,
        p.member,
        p.retained
    )
}
fn decode_position(text: &str, viewer_id: &str, member_id: &str) -> ConversationSince {
    let parts: Vec<_> = text.split('-').collect();
    let number = |s: &str| {
        u64::from_str_radix(s, 16)
            .ok()
            .filter(|v| *v <= MAX_JS_SAFE_INTEGER)
    };
    match parts.as_slice() {
        ["c1", tag, viewer, member, retained] if *tag == scope_tag(viewer_id, member_id) => {
            match (number(viewer), number(member), number(retained)) {
                (Some(viewer), Some(member), Some(retained)) => {
                    ConversationSince::Position(ConversationPosition {
                        viewer,
                        member,
                        retained,
                    })
                }
                _ => ConversationSince::Foreign,
            }
        }
        _ => ConversationSince::Foreign,
    }
}
fn valid_position(text: &str) -> bool {
    (1..=64).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn conversation_query(input: QueryWire) -> Option<ConversationInput> {
    let member_id = input.member_id.filter(|id| canonical_id(id))?;
    if input.originator_id.is_some() || input.recipient_id.is_some() || input.room_id.is_some() {
        return None;
    }
    let limit = input.limit.unwrap_or(CONVERSATION_LIMIT);
    if !(1..=HISTORY_MAX_LIMIT).contains(&limit)
        || input.since.as_deref().is_some_and(|s| !valid_position(s))
    {
        return None;
    }
    let before = match input.before {
        None => None,
        Some(CursorWire {
            prepared_at_ms: Some(prepared_at_ms),
            submitted_at_ms: None,
            answered_at_ms: None,
            request_id,
        }) if prepared_at_ms > 0
            && prepared_at_ms <= MAX_JS_SAFE_INTEGER
            && valid_request_id(&request_id) =>
        {
            Some(HistoryCursor::Prepared {
                prepared_at_ms,
                request_id,
            })
        }
        Some(_) => return None,
    };
    Some(ConversationInput {
        member_id,
        limit,
        before,
        since: input.since,
    })
}

fn decode_wire(bytes: &[u8]) -> Option<QueryWire> {
    if bytes.len() > HISTORY_INPUT_LIMIT {
        return None;
    }
    serde_json::from_slice(bytes).ok()
}

pub fn decode_list_query(bytes: &[u8]) -> Option<ListQuery> {
    let input = decode_wire(bytes)?;
    match input.view.as_deref() {
        Some("answers") => answers_query(input).map(ListQuery::Answers),
        Some("conversation") => conversation_query(input).map(ListQuery::Conversation),
        _ if input.member_id.is_some() || input.since.is_some() => None,
        _ => history_query(input).map(ListQuery::History),
    }
}

pub fn decode_history_query(bytes: &[u8]) -> Option<HistoryQuery> {
    history_query(decode_wire(bytes)?)
}

/// Only the originator, a limit and a cursor over answer time: an answers page lists
/// everything the caller sent, across recipients and rooms.
fn answers_query(input: QueryWire) -> Option<AnswersQuery> {
    let originator_id = input.originator_id.filter(|id| canonical_id(id))?;
    if input.recipient_id.is_some() || input.room_id.is_some() {
        return None;
    }
    let limit = input.limit.unwrap_or(RESULTS_LIMIT);
    if !(1..=HISTORY_MAX_LIMIT).contains(&limit) {
        return None;
    }
    let before = match input.before {
        None => None,
        Some(cursor) => {
            let (None, None, Some(answered_at_ms)) = (
                cursor.prepared_at_ms,
                cursor.submitted_at_ms,
                cursor.answered_at_ms,
            ) else {
                return None;
            };
            if answered_at_ms == 0
                || answered_at_ms > MAX_JS_SAFE_INTEGER
                || !valid_request_id(&cursor.request_id)
            {
                return None;
            }
            Some(AnswerCursor {
                answered_at_ms,
                request_id: cursor.request_id,
            })
        }
    };
    Some(AnswersQuery {
        originator_id,
        before,
        limit,
    })
}

fn history_query(input: QueryWire) -> Option<HistoryQuery> {
    if input
        .recipient_id
        .as_deref()
        .is_some_and(|id| !canonical_id(id))
        || input.room_id.as_deref().is_some_and(|id| !canonical_id(id))
    {
        return None;
    }
    let scope = match (
        input.originator_id,
        input.view.as_deref(),
        input.recipient_id,
        input.room_id,
    ) {
        (Some(originator_id), Some("results"), recipient_id, None)
            if canonical_id(&originator_id) =>
        {
            HistoryScope::OriginatorResults {
                originator_id,
                recipient_id,
            }
        }
        (None, None, Some(identity_id), room_id) => HistoryScope::Recipient {
            identity_id,
            room_id,
        },
        (None, None, None, Some(room)) => HistoryScope::Room(room),
        _ => return None,
    };
    let results = matches!(scope, HistoryScope::OriginatorResults { .. });
    let limit = input.limit.unwrap_or(if results {
        RESULTS_LIMIT
    } else {
        HISTORY_LIMIT
    });
    if !(1..=HISTORY_MAX_LIMIT).contains(&limit) {
        return None;
    }
    let before = match input.before {
        None => None,
        Some(cursor) => {
            let timestamp = match (
                results,
                cursor.prepared_at_ms,
                cursor.submitted_at_ms,
                cursor.answered_at_ms,
            ) {
                (false, Some(time), None, None) | (true, None, Some(time), None) => time,
                _ => return None,
            };
            if timestamp == 0
                || timestamp > MAX_JS_SAFE_INTEGER
                || !valid_request_id(&cursor.request_id)
            {
                return None;
            }
            Some(if results {
                HistoryCursor::Submitted {
                    submitted_at_ms: timestamp,
                    request_id: cursor.request_id,
                }
            } else {
                HistoryCursor::Prepared {
                    prepared_at_ms: timestamp,
                    request_id: cursor.request_id,
                }
            })
        }
    };
    Some(HistoryQuery {
        scope,
        limit,
        before,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequestWire {
    request_id: String,
}

pub fn decode_history_request(bytes: &[u8]) -> Option<String> {
    if bytes.len() > HISTORY_INPUT_LIMIT {
        return None;
    }
    let input: RequestWire = serde_json::from_slice(bytes).ok()?;
    valid_request_id(&input.request_id).then_some(input.request_id)
}

/// The `messageState` object every client prints: history, `x`, `inbox` and `x listen` share it.
pub fn message_state(view: &tmt_core::request::delivery::DeliveryView) -> Value {
    json!({"state":view.state.as_str(),"reason":{"code":view.reason.code(),"text":view.reason_text},
        "latestMs":view.latest_ms,"remainingMs":view.remaining_ms,"canSendNow":view.can_send_now})
}

fn item_document<T>(item: &HistoryItem<T>, content: impl FnOnce(&T) -> Option<Value>) -> Value {
    let final_state = match &item.final_state {
        FinalState::Withdrawn(withdrawal) => {
            json!({"status":"withdrawn", "reason":withdrawal.reason, "withdrawnAtMs":withdrawal.withdrawn_at_ms})
        }
        FinalState::NotSubmitted => json!({"status":"not_submitted"}),
        FinalState::NotRequired => json!({"status":"not_required"}),
        FinalState::Retained {
            content: body,
            submitted_at_ms,
            body_bytes,
            expires_at_ms,
        } => {
            let mut value = json!({"status":"retained","submittedAtMs":submitted_at_ms,"bodyBytes":body_bytes,"expiresAtMs":expires_at_ms});
            if let Some(body) = content(body) {
                value["response"] = body;
            }
            value
        }
        FinalState::Expired {
            submitted_at_ms,
            expires_at_ms,
        } => {
            json!({"status":"expired","submittedAtMs":submitted_at_ms,"expiresAtMs":expires_at_ms})
        }
        FinalState::Unavailable {
            submitted_at_ms,
            expires_at_ms,
        } => {
            json!({"status":"unavailable","submittedAtMs":submitted_at_ms,"expiresAtMs":expires_at_ms})
        }
    };
    let mut value = json!({"requestId":item.request_id,"roomId":item.room_id,"recipientId":item.recipient_identity_id,
        "sender":{"kind":item.originator.as_str(),"identityId":item.originator.identity_id()},
        "kind":item.kind.as_str(),"origin":item.origin.as_str(),"urgent":item.delivery_policy.urgent,"digestKind":item.delivery_policy.kind.as_str(),"mode":item.delivery_policy.mode.as_str(),"preparedAtMs":item.prepared_at_ms,"delivery":item.delivery.as_str(),"messageState":message_state(&item.delivery_view),
        "recipientAcknowledged":item.recipient_acknowledged,"final":final_state});
    // Only a passthrough has one: the turn output its typed text earned (#4336).
    if let Some(capture) = &item.capture {
        value["passthrough"] = json!({
            "state":capture.state.as_str(),"deliveredAtMs":capture.delivered_at_ms,
            "boundAtMs":capture.bound_at_ms,"folded":capture.folded,"settledAtMs":capture.settled_at_ms,
            "answer":capture.answer.as_ref().map(|answer| {
                let mut value = json!({
                    "text":answer.text,"truncated":answer.truncated,
                    "provider":answer.provider,"endedMs":answer.ended_ms
                });
                if let Some(response) = &answer.response_id {
                    value["responseId"] = json!(response);
                }
                value
            })
        });
        if let Some(batch) = &capture.input_batch_id {
            value["passthrough"]["inputBatchId"] = json!(batch);
        }
    }
    value
}

pub fn encode_history_page(page: &HistoryPage, results: bool) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "items":page.items.iter().map(|row| {
            let mut value = item_document(&row.item, |_| None);
            value["preview"] = json!(row.preview);
            if results {
                value["responsePreview"] = json!(row.response_preview.as_ref().map(|preview| &preview.text));
                value["previewTruncated"] = json!(row.response_preview.as_ref().is_some_and(|preview| preview.truncated));
            }
            value
        }).collect::<Vec<_>>(),
        "nextBefore":page.next_before.as_ref().map(|cursor| match cursor {
            HistoryCursor::Prepared { prepared_at_ms, request_id } => json!({"preparedAtMs":prepared_at_ms,"requestId":request_id}),
            HistoryCursor::Submitted { submitted_at_ms, request_id } => json!({"submittedAtMs":submitted_at_ms,"requestId":request_id}),
        }),
    })).expect("serializable request history")
}

/// The conversation page (#5807): the `results` item fields, plus `direction`,
/// `changePosition` and `responseId` when the request has one; no room, receipt or pane.
pub fn encode_conversation_page(
    page: &ConversationPage,
    viewer_id: &str,
    member_id: &str,
    member: &str,
) -> Vec<u8> {
    let items: Vec<_> = page
        .items
        .iter()
        .map(|row| {
            let full = item_document(&row.summary.item, |_| None);
            let mut value = serde_json::Map::new();
            for key in [
                "requestId",
                "recipientId",
                "sender",
                "kind",
                "origin",
                "preparedAtMs",
                "delivery",
                "messageState",
                "final",
            ] {
                value.insert(key.into(), full[key].clone());
            }
            value.insert("preview".into(), json!(row.summary.preview));
            value.insert(
                "responsePreview".into(),
                json!(row.summary.response_preview.as_ref().map(|p| &p.text)),
            );
            value.insert(
                "previewTruncated".into(),
                json!(
                    row.summary
                        .response_preview
                        .as_ref()
                        .is_some_and(|p| p.truncated)
                ),
            );
            value.insert(
                "direction".into(),
                json!(match row.direction {
                    ConversationDirection::ToMember => "toMember",
                    ConversationDirection::FromMember => "fromMember",
                }),
            );
            let (viewer, member) = row.position;
            value.insert(
                "changePosition".into(),
                json!(encode_position(
                    viewer_id,
                    member_id,
                    &ConversationPosition {
                        viewer,
                        member,
                        retained: 0
                    }
                )),
            );
            if let Some(response) = row
                .summary
                .item
                .capture
                .as_ref()
                .and_then(|c| c.answer.as_ref())
                .and_then(|a| a.response_id.as_ref())
            {
                value.insert("responseId".into(), json!(response));
            }
            Value::Object(value)
        })
        .collect();
    let mut value = json!({
        "viewerId": viewer_id,
        "member": member,
        "items": items,
        "nextBefore": page.next_before.as_ref().map(|cursor| json!({"preparedAtMs":cursor.timestamp(),"requestId":cursor.request_id()})),
        "changePosition": encode_position(viewer_id, member_id, &page.position),
    });
    if let Some(changed) = page.changed_since {
        value["changedSince"] = match changed {
            ChangedSince::Count { count, more } => json!({"count":count,"more":more}),
            ChangedSince::Unknown => json!("unknown"),
        };
    }
    serde_json::to_vec(&value).expect("serializable conversation")
}

pub fn encode_answers_page(page: &AnswersPage) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "items":page.items.iter().map(|answer| {
            let mut value = json!({
                "requestId":answer.request_id,"kind":answer.kind.as_str(),
                "sender":{"kind":answer.originator.as_str(),"identityId":answer.originator.identity_id()},
                "recipientId":answer.recipient_identity_id,
                "answeredAtMs":answer.answered_at_ms,"answer":answer.answer.as_str(),
                "revision":answer.revision,"acknowledged":answer.acknowledged
            });
            if let Some(response) = &answer.response_id {
                value["responseId"] = json!(response);
            }
            value
        }).collect::<Vec<_>>(),
        "nextBefore":page.next_before.as_ref().map(|cursor| json!({
            "answeredAtMs":cursor.answered_at_ms,"requestId":cursor.request_id
        })),
    })).expect("serializable request answers")
}

pub fn encode_history_detail(detail: &HistoryDetail) -> Vec<u8> {
    let mut value = item_document(&detail.item, |body| Some(json!(body)));
    value["prompt"] = match &detail.prompt {
        RequestPrompt::Unavailable => json!({"status":"unavailable"}),
        RequestPrompt::Expired { expires_at_ms } => {
            json!({"status":"expired","expiresAtMs":expires_at_ms})
        }
        RequestPrompt::Retained(prompt) => {
            json!({"status":"retained","message":prompt.message,"messageBytes":prompt.message_bytes,"expiresAtMs":prompt.expires_at_ms})
        }
    };
    serde_json::to_vec(&value).expect("serializable request detail")
}

#[cfg(test)]
mod tests;
