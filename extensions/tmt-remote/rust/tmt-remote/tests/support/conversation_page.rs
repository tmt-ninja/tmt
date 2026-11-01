//! Maximum valid fields, including four-byte scalars and JSON control escapes.
use serde_json::{Value, json};
pub fn maximum_page(member: &str, viewer: &str, withdrawn: bool, escaped: bool) -> Value {
    let text = |bytes: usize| {
        if escaped {
            "\0".repeat(bytes)
        } else {
            "🦊".repeat(bytes / 4)
        }
    };
    let preview = if escaped { "\0".repeat(160) } else { text(640) };
    let maximum = 9_007_199_254_740_991u64;
    let final_value = if withdrawn {
        json!({"status":"withdrawn","reason":text(1024),"withdrawnAtMs":maximum})
    } else {
        json!({"status":"retained","submittedAtMs":maximum,"expiresAtMs":maximum,"bodyBytes":maximum})
    };
    let items = (0..50).map(|index| json!({
        "requestId":format!("req_00000000-0000-4000-8000-{index:012}"),"recipientId":member,
        "sender":{"kind":"verified","identityId":viewer},"kind":"request","origin":"automation",
        "preparedAtMs":maximum,"delivery":"definitely_failed",
        "messageState":{"state":"answered","reason":{"code":"r".repeat(64),"text":text(256)},"latestMs":maximum,"remainingMs":maximum,"canSendNow":false},
        "final":final_value,"preview":preview,"responsePreview":if withdrawn {Value::Null} else {json!(preview)},
        "previewTruncated":!withdrawn,"direction":"toMember","changePosition":"x".repeat(64),"responseId":"r".repeat(128)
    })).collect::<Vec<_>>();
    json!({"viewerId":viewer,"member":"active","items":items,
        "nextBefore":{"preparedAtMs":maximum,"requestId":"req_00000000-0000-4000-8000-000000000049"},
        "changePosition":"p".repeat(64),"changedSince":{"count":50,"more":true}})
}
