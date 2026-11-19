//! Inert discussion record admission. Envelopes authenticate writers; no DOM,
//! publication, signing or dispatch authority lives in this codec.
use crate::limits::{
    COMMENT_BODY_BYTES, COMMENT_CONTEXT_BYTES, COMMENT_CONTEXT_POINTS, MAX_SEQUENCE,
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use tmt_colab_model::{Invalid, Result, attachment, bounded::List, values};
pub mod status;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct QuoteSelector {
    pub exact: String,
    pub prefix: String,
    pub suffix: String,
}
impl QuoteSelector {
    pub fn validate(&self) -> Result<()> {
        require(!self.exact.is_empty() && self.exact.len() <= COMMENT_BODY_BYTES)?;
        for context in [&self.prefix, &self.suffix] {
            require(
                context.len() <= COMMENT_CONTEXT_BYTES
                    && context.chars().count() <= COMMENT_CONTEXT_POINTS,
            )?;
        }
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(untagged)]
enum ThreadAnchor {
    Quote(QuoteSelector),
    Block(BlockAnchor),
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BlockAnchor {
    block: String,
    #[serde(default)]
    quote: Option<QuoteSelector>,
}
impl ThreadAnchor {
    fn validate(&self) -> Result<()> {
        match self {
            Self::Quote(quote) => quote.validate(),
            Self::Block(anchor) => {
                values::generated_id(&anchor.block)?;
                if let Some(quote) = &anchor.quote {
                    quote.validate()?;
                }
                Ok(())
            }
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThreadRecord {
    version: u8,
    kind: String,
    space_id: String,
    page_id: String,
    epoch: String,
    sender_device: String,
    revision: String,
    deleted: bool,
    device_name: String,
    at: String,
    thread_id: String,
    anchor: Option<ThreadAnchor>,
    #[serde(rename = "resolved")]
    _resolved: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ThreadRef {
    writer: String,
    id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommentRecord {
    version: u8,
    kind: String,
    space_id: String,
    page_id: String,
    epoch: String,
    sender_device: String,
    revision: String,
    deleted: bool,
    device_name: String,
    at: String,
    message_id: String,
    #[serde(default)]
    question_id: Option<String>,
    thread: ThreadRef,
    body: String,
    #[serde(default)]
    sequence: Option<String>,
    #[serde(default, deserialize_with = "comment_attachments")]
    attachments: Option<attachment::MessageAttachments>,
}
fn comment_attachments<'de, D: Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<attachment::MessageAttachments>, D::Error> {
    List::deserialize(d).map(Some)
}
fn scope(
    version: u8,
    space: &str,
    page: &str,
    epoch: &str,
    sender: &str,
    revision: &str,
    name: &str,
) -> Result<()> {
    require(version == 1 && name.len() <= 128)?;
    values::space_id(space)?;
    values::generated_id(page)?;
    values::generated_id(sender)?;
    values::decimal(epoch, false)?;
    values::decimal(revision, false)?;
    Ok(())
}
fn timestamp(at: &str) -> Result<()> {
    require(values::decimal(at, true)? <= 8_640_000_000_000_000)
}
fn require(valid: bool) -> Result<()> {
    if valid { Ok(()) } else { Err(Invalid) }
}
/// A valid block anchor is usable only in the structured page that admitted it.
pub(crate) fn validate_page_anchor(value: &Value, structured: bool, retained: bool) -> Result<()> {
    require(
        structured
            || retained
            || value
                .get("anchor")
                .and_then(|anchor| anchor.get("block"))
                .is_none(),
    )
}
/// A later record may retain only an anchor already admitted for this writer's same thread.
pub(crate) fn retained_anchor(
    value: &Value,
    previous: Option<&serde_json::Map<String, Value>>,
) -> bool {
    let (Some(id), Some(anchor)) = (
        value.get("threadId").and_then(Value::as_str),
        value.get("anchor"),
    ) else {
        return false;
    };
    if anchor.get("block").is_none() {
        return false;
    }
    previous.is_some_and(|threads| {
        threads.values().any(|thread| {
            thread.get("threadId").and_then(Value::as_str) == Some(id)
                && thread.get("anchor") == Some(anchor)
        })
    })
}
/// Retired proposal records remain in the own document but have no current projection.
pub(crate) fn retired_record(root: &str, value: &Value) -> bool {
    match value.get("kind").and_then(Value::as_str) {
        Some("thread") => root == "threads" && value.get("proposal").is_some(),
        Some("proposal-decision") => root == "messages",
        _ => false,
    }
}
pub(crate) fn validate_record(root: &str, key: &str, value: &Value) -> Result<()> {
    match value.get("kind").and_then(Value::as_str) {
        Some("thread-status" | "thread-notification") => status::validate(root, key, value)?,
        Some("thread") => {
            // Optional quote may be absent, never explicit null.
            if let Some(anchor) = value.get("anchor").and_then(Value::as_object)
                && anchor.contains_key("block")
            {
                require(anchor.get("quote").is_none_or(Value::is_object))?;
            }
            require(
                value
                    .as_object()
                    .is_some_and(|v| v.len() == 13 && v.contains_key("anchor")),
            )?;
            let v: ThreadRecord = serde_json::from_value(value.clone()).map_err(|_| Invalid)?;
            require(
                root == "threads"
                    && v.kind == "thread"
                    && key == format!("{}:{}", v.thread_id, v.revision),
            )?;
            values::generated_id(&v.thread_id)?;
            scope(
                v.version,
                &v.space_id,
                &v.page_id,
                &v.epoch,
                &v.sender_device,
                &v.revision,
                &v.device_name,
            )?;
            timestamp(&v.at)?;
            require(!v.deleted || v.anchor.is_none())?;
            if let Some(anchor) = v.anchor {
                anchor.validate()?;
            }
        }
        Some("comment") => {
            // An explicit null is not an absent field.
            require(value.get("sequence").is_none_or(Value::is_string))?;
            require(value.get("questionId").is_none_or(Value::is_string))?;
            let v: CommentRecord = serde_json::from_value(value.clone()).map_err(|_| Invalid)?;
            require(
                root == "messages"
                    && v.kind == "comment"
                    && key == format!("{}:{}", v.message_id, v.revision),
            )?;
            values::generated_id(&v.message_id)?;
            if let Some(id) = &v.question_id {
                require(crate::page_check::valid_question_id(id))?;
            }
            values::generated_id(&v.thread.writer)?;
            values::generated_id(&v.thread.id)?;
            scope(
                v.version,
                &v.space_id,
                &v.page_id,
                &v.epoch,
                &v.sender_device,
                &v.revision,
                &v.device_name,
            )?;
            timestamp(&v.at)?;
            if let Some(sequence) = &v.sequence {
                require(values::decimal(sequence, false)? <= MAX_SEQUENCE)?;
            }
            require(v.body.len() <= COMMENT_BODY_BYTES)?;
            let attachments = v.attachments.as_ref().map_or(&[][..], List::as_slice);
            attachment::validate_attachment_list(
                attachments,
                attachment::MESSAGE_ATTACHMENTS,
                Some((&v.space_id, &v.page_id)),
            )?;
            require(if v.deleted {
                v.body.is_empty() && attachments.is_empty()
            } else {
                !v.body.is_empty() || !attachments.is_empty()
            })?;
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn block_anchor_vectors_validate_the_same_record_shape() {
        let f: Value = serde_json::from_str(include_str!(
            "../../../contracts/vectors/discussion-v1.json"
        ))
        .unwrap();
        let mut thread = f["thread"].clone();
        let key = format!("{}:1", thread["threadId"].as_str().unwrap());
        for case in f["blockAnchorCases"].as_array().unwrap() {
            thread["anchor"] = case["anchor"].clone();
            assert_eq!(
                validate_record("threads", &key, &thread).is_ok(),
                case["valid"] == true,
                "{}",
                case["name"]
            );
        }
        thread["anchor"] = f["blockAnchorCases"][0]["anchor"].clone();
        assert!(validate_page_anchor(&thread, true, false).is_ok());
        assert!(validate_page_anchor(&thread, false, false).is_err());
        assert!(validate_page_anchor(&thread, false, true).is_ok());
        let existing = serde_json::Map::from_iter([(key.clone(), thread.clone())]);
        assert!(retained_anchor(&thread, Some(&existing)));
        let mut other = thread.clone();
        other["threadId"] = serde_json::json!("00000000-0000-4000-8000-000000000011");
        assert!(!retained_anchor(&other, Some(&existing)));
        other = thread.clone();
        other["anchor"]["block"] = serde_json::json!("00000000-0000-4000-8000-000000000012");
        assert!(!retained_anchor(&other, Some(&existing)));
    }
    #[test]
    fn comment_sequence_is_a_canonical_decimal_up_to_two_to_the_53_minus_1() {
        let f: Value = serde_json::from_str(include_str!(
            "../../../contracts/vectors/discussion-v1.json"
        ))
        .unwrap();
        let comment = f["comment"].clone();
        let key = format!("{}:1", comment["messageId"].as_str().unwrap());
        validate_record("messages", &key, &comment).unwrap();
        let cases = &f["sequenceCases"];
        for valid in cases["valid"].as_array().unwrap() {
            let mut value = comment.clone();
            value["sequence"] = valid.clone();
            validate_record("messages", &key, &value).unwrap();
        }
        for invalid in cases["invalid"]
            .as_array()
            .unwrap()
            .iter()
            .chain(cases["invalidTypes"].as_array().unwrap())
        {
            let mut value = comment.clone();
            value["sequence"] = invalid.clone();
            assert!(
                validate_record("messages", &key, &value).is_err(),
                "{invalid}"
            );
        }
    }
}

#[cfg(test)]
mod question_binding_tests {
    use super::*;
    #[test]
    fn ordinary_comment_question_bindings_are_closed_and_use_markup_uuid_grammar() {
        let vector: Value = serde_json::from_str(include_str!(
            "../../../contracts/vectors/discussion-v1.json"
        ))
        .unwrap();
        let mut comment = vector["comment"].clone();
        comment["questionId"] = serde_json::json!("00000000-0000-0000-0000-000000000001");
        let key = format!(
            "{}:{}",
            comment["messageId"].as_str().unwrap(),
            comment["revision"].as_str().unwrap()
        );
        assert!(validate_record("messages", &key, &comment).is_ok());
        for id in [
            Value::Null,
            serde_json::json!(""),
            serde_json::json!("not-a-question"),
            serde_json::json!("ABCDEF00-0000-0000-0000-000000000001"),
        ] {
            comment["questionId"] = id;
            assert!(validate_record("messages", &key, &comment).is_err());
        }
    }
}
