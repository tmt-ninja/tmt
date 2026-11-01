//! Firestore REST-value interpretation; no network or credential ownership.
use crate::{sealed_sync::SyncError, wire};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Map, Value};
const SAFE: i64 = (1i64 << 53) - 1;
fn invalid<T>() -> Result<T, SyncError> {
    Err(SyncError::Invalid)
}
fn integer(value: &str) -> bool {
    value
        .parse::<i64>()
        .is_ok_and(|n| (-SAFE..=SAFE).contains(&n) && n.to_string() == value)
}
fn timestamp(value: &str) -> bool {
    let b = value.as_bytes();
    if !b.is_ascii()
        || ![20, 24, 27].contains(&b.len())
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[b.len() - 1] != b'Z'
    {
        return false;
    }
    let number = |start, end| {
        value
            .get(start..end)
            .filter(|s| s.bytes().all(|b| b.is_ascii_digit()))
            .and_then(|s| s.parse::<u32>().ok())
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(0, 4),
        number(5, 7),
        number(8, 10),
        number(11, 13),
        number(14, 16),
        number(17, 19),
    ) else {
        return false;
    };
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => 28 + u32::from(year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)),
        _ => return false,
    };
    if year == 0 || day == 0 || day > days || hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    if b.len() > 20
        && (b[19] != b'.'
            || !b[20..b.len() - 1].iter().all(u8::is_ascii_digit)
            || &value[b.len() - 4..b.len() - 1] == "000")
    {
        return false;
    }
    true
}
pub(super) fn field(value: &Value) -> bool {
    let Some(row) = value.as_object() else {
        return false;
    };
    if row.len() != 1 {
        return false;
    }
    let (kind, value) = row.iter().next().expect("one value");
    match kind.as_str() {
        "stringValue" => value.is_string(),
        "integerValue" => value.as_str().is_some_and(integer),
        "booleanValue" => value.is_boolean(),
        "nullValue" => value.is_null(),
        "timestampValue" => value.as_str().is_some_and(timestamp),
        "bytesValue" => value.as_str().is_some_and(|s| {
            STANDARD
                .decode(s)
                .is_ok_and(|bytes| STANDARD.encode(bytes) == s)
        }),
        _ => false,
    }
}
pub(super) fn text_is(value: Option<&Value>, expected: &str) -> bool {
    value.is_some_and(|v| {
        v.as_object().is_some_and(|o| {
            o.len() == 1 && o.get("stringValue").and_then(Value::as_str) == Some(expected)
        })
    })
}
/// Validate a standalone fields map for codec vectors without fabricating a provider response.
pub(super) fn validate_fields(bytes: &[u8]) -> Result<Map<String, Value>, SyncError> {
    let mut value = wire::strict_json(bytes).ok_or(SyncError::Invalid)?;
    value.sort_all_objects();
    if serde_json::to_vec(&value).map_err(|_| SyncError::Invalid)? != bytes {
        return invalid();
    }
    let row = value.as_object().ok_or(SyncError::Invalid)?;
    if row.len() > 64
        || !row
            .iter()
            .all(|(key, value)| crate::declaration::sync_field_name(key) && field(value))
    {
        return invalid();
    }
    Ok(row.clone())
}

pub(crate) struct SealedFieldsCodec;
impl crate::sealed_sync::FieldCodec for SealedFieldsCodec {
    fn document(
        &self,
        context: &crate::sealed_sync::SyncContext,
        root: &str,
        value: &Value,
        resource: &str,
    ) -> Result<crate::sealed_sync::Document, SyncError> {
        use crate::sealed_sync::{Document, DocumentAccess, Target, validate_document};
        let name = value
            .get("name")
            .and_then(Value::as_str)
            .ok_or(SyncError::Unavailable)?;
        let mapping = context
            .resources()
            .iter()
            .find(|r| r.name == resource)
            .ok_or(SyncError::Invalid)?;
        let prefix = format!("{}/x/{}/{}/", root, context.extension(), mapping.path);
        let id = name.strip_prefix(&prefix).ok_or(SyncError::Denied)?;
        let mut fields = value.get("fields").cloned().ok_or(SyncError::Unavailable)?;
        fields.sort_all_objects();
        let bytes = serde_json::to_vec(&fields).map_err(|_| SyncError::Unavailable)?;
        let document = Document {
            target: Target {
                resource: resource.into(),
                id: id.into(),
            },
            digest: crate::deploy_plan::sha256_hex(&bytes),
            bytes,
        };
        validate_document(context, &document, DocumentAccess::Read)?;
        Ok(document)
    }
    fn fields(&self, bytes: &[u8]) -> Result<Map<String, Value>, SyncError> {
        validate_fields(bytes)
    }
    fn field(&self, value: &Value) -> bool {
        field(value)
    }
    fn text_is(&self, value: Option<&Value>, expected: &str) -> bool {
        text_is(value, expected)
    }
    fn sequence(&self, value: &Value) -> Option<u64> {
        value
            .get("integerValue")
            .and_then(Value::as_str)
            .and_then(|s| s.parse().ok())
    }
    fn string<'a>(&self, value: &'a Value) -> Option<&'a str> {
        value.get("stringValue").and_then(Value::as_str)
    }
}
