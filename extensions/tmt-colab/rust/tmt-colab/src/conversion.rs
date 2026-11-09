//! Pure projection of a revision-fenced HTML-to-blocks conversion.
use crate::decoder::DecodeFault;
use serde_json::{Value, json};

/// The publication owner checks the revision and authority before applying this projection.
pub(crate) fn project(base: &Value, body: &Value) -> Result<Value, DecodeFault> {
    let body = body.as_object().ok_or(DecodeFault::InvalidInput)?;
    let at = body
        .get("convertedAt")
        .and_then(Value::as_u64)
        .ok_or(DecodeFault::InvalidInput)?;
    if body.len() != 1 || tmt_colab_model::values::time(at).is_err() {
        return Err(DecodeFault::InvalidInput);
    }
    let meta = base
        .get("meta")
        .and_then(Value::as_object)
        .ok_or(DecodeFault::InvalidInput)?;
    if meta.contains_key("pageType") || meta.contains_key("template") || !base["html"].is_string() {
        return Err(DecodeFault::InvalidInput);
    }
    let mut next = base.clone();
    next["blocks"] = json!({});
    let meta = next["meta"]
        .as_object_mut()
        .ok_or(DecodeFault::InvalidInput)?;
    if let Some(layout) = meta.remove("layout") {
        let mut legacy = serde_json::Map::new();
        legacy.insert("layout".into(), layout);
        if let Some(reason) = meta.remove("layoutReason") {
            legacy.insert("layoutReason".into(), reason);
        }
        meta.insert("legacyLayout".into(), Value::Object(legacy));
    }
    meta.insert("pageType".into(), json!("blocks"));
    meta.insert("convertedAt".into(), json!(at));
    Ok(next)
}

// Revert discards the current blocks only when this page actually retains legacy HTML.
pub(crate) fn revert(base: &Value, body: &Value) -> Result<Value, DecodeFault> {
    if body.as_object().is_none_or(|body| !body.is_empty())
        || base["meta"]["pageType"] != "blocks"
        || !base["meta"].get("convertedAt").is_some_and(Value::is_u64)
        || !base["html"].is_string()
    {
        return Err(DecodeFault::InvalidInput);
    }
    let mut next = base.clone();
    next.as_object_mut()
        .ok_or(DecodeFault::InvalidInput)?
        .remove("blocks");
    let meta = next["meta"]
        .as_object_mut()
        .ok_or(DecodeFault::InvalidInput)?;
    meta.remove("pageType");
    meta.remove("convertedAt");
    if let Some(legacy) = meta
        .remove("legacyLayout")
        .and_then(|v| v.as_object().cloned())
    {
        if let Some(layout) = legacy.get("layout") {
            meta.insert("layout".into(), layout.clone());
        }
        if let Some(reason) = legacy.get("layoutReason") {
            meta.insert("layoutReason".into(), reason.clone());
        }
    }
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversion_keeps_legacy_bytes_and_unrelated_metadata() {
        for source in ["", "<p>café 🐈</p>\r\n"] {
            let base = json!({"html":source,"meta":{"title":"Page","layout":"canvas","layoutReason":"chart","work":{"version":2,"order":[]},"questions":[]}});
            let next = project(&base, &json!({"convertedAt":123})).unwrap();
            assert_eq!(next["html"], source);
            assert_eq!(next["meta"]["work"], base["meta"]["work"]);
            assert_eq!(next["meta"]["questions"], base["meta"]["questions"]);
            assert_eq!(next["meta"]["convertedAt"], 123);
            assert!(next["meta"].get("layout").is_none());
            assert!(next["meta"].get("layoutReason").is_none());
            assert_eq!(
                next["meta"]["legacyLayout"],
                json!({"layout":"canvas","layoutReason":"chart"})
            );
            assert_eq!(next["blocks"], json!({}));
            let restored = revert(&next, &json!({})).unwrap();
            assert_eq!(restored["meta"]["layout"], "canvas");
            assert_eq!(restored["meta"]["layoutReason"], "chart");
            assert!(restored["meta"].get("legacyLayout").is_none());
        }
    }

    #[test]
    fn conversion_refuses_templates_structured_pages_and_bad_timestamps() {
        let base = json!({"html":"x","meta":{"title":"Page"}});
        assert!(
            project(
                &json!({"html":"x","meta":{"template":{}}}),
                &json!({"convertedAt":1})
            )
            .is_err()
        );
        assert!(
            project(
                &json!({"html":"x","meta":{"pageType":"blocks"}}),
                &json!({"convertedAt":1})
            )
            .is_err()
        );
        for body in [
            json!({}),
            json!({"convertedAt":-1}),
            json!({"convertedAt":9007199254740992_u64}),
            json!({"convertedAt":1,"extra":true}),
        ] {
            assert!(project(&base, &body).is_err());
        }
    }

    #[test]
    fn revert_requires_legacy_marker_and_discards_blocks() {
        let base = json!({"html":"<p>old</p>\r\n","meta":{"title":"Page","pageType":"blocks","convertedAt":1},"blocks":{"a":{"type":"paragraph"}}});
        let next = revert(&base, &json!({})).unwrap();
        assert_eq!(next["html"], base["html"]);
        assert!(next.get("blocks").is_none());
        assert!(next["meta"].get("pageType").is_none());
        assert!(next["meta"].get("convertedAt").is_none());
        let mut no_legacy = base.clone();
        no_legacy["meta"]
            .as_object_mut()
            .unwrap()
            .remove("convertedAt");
        assert!(revert(&no_legacy, &json!({})).is_err());
        assert!(revert(&base, &json!({"extra":true})).is_err());
    }
}
