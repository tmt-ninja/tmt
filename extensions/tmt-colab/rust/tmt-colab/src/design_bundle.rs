//! A design-system bundle's own hash and release check, shared by `tmt colab design` and the
//! standalone export (#6157): the same answer `design-system.ts` gives, for the bytes a release or
//! the built-in system carries.
use serde_json::Value;

/// The built-in tmt GUI release every install can pin; the app resolves the same bytes.
pub const BUILT_IN_BUNDLE: &str =
    include_str!("../../../../../design/systems/tmt-gui/generated/bundle.json");

const CONFIG_OPEN: &str = r#"<script type="application/json" data-tmt-ds="design-system">"#;

/// The root page's config block, parsed; the block's JSON never holds a raw `<`.
pub fn config(source: &str) -> Option<Value> {
    let start = source.find(CONFIG_OPEN)? + CONFIG_OPEN.len();
    let end = start + source[start..].find("</script>")?;
    serde_json::from_str(&source[start..end]).ok()
}

/// The attachment id of the release `version` whose record names `hash`, from a system root page's
/// source, as the app finds it (`pageDesignSystems`).
pub fn release_attachment(root_source: &str, version: &str, hash: &str) -> Option<String> {
    config(root_source)?["releases"]
        .as_array()?
        .iter()
        .find(|release| release["version"] == version && release["bundle"] == hash)?["attachment"]
        .as_str()
        .map(str::to_owned)
}

/// Whether `bundle` is the release its record names: the same version, a declared hash equal to the
/// record's, and bytes that hash to it. The renderer refuses a pin whose bundle hashes differently
/// (`design-system.ts`), so `show` never prints one (#5966).
pub fn matches_release(bundle: &Value, release: &Value) -> bool {
    bundle["version"] == release["version"]
        && bundle["hash"] == release["bundle"]
        && bundle_hash(bundle).is_some_and(|hash| release["bundle"] == hash.as_str())
}

/// The bundle's own hash as `bundleHash` in `design-system.ts` and the compiler compute it: SHA-256
/// over `JSON.stringify` of the bundle without `hash`, keys in written order. `None` when a number is
/// not written as `JSON.stringify` writes it, so the two could disagree; compiled bundles never
/// hold one.
pub fn bundle_hash(bundle: &Value) -> Option<String> {
    use sha2::{Digest, Sha256};
    let mut body = bundle.as_object()?.clone();
    body.shift_remove("hash");
    let body = Value::Object(body);
    if !canonical_numbers(&body) {
        return None;
    }
    let digest = Sha256::digest(serde_json::to_vec(&body).ok()?);
    Some(format!(
        "sha256-{}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

/// Every number is written as `JSON.stringify` writes its value: the shortest round-trip digits,
/// without an exponent, in the range where JavaScript writes none.
fn canonical_numbers(value: &Value) -> bool {
    match value {
        Value::Number(number) => {
            let text = number.to_string();
            text.parse::<f64>().is_ok_and(|parsed| {
                let magnitude = parsed.abs();
                (magnitude == 0.0 && text == "0")
                    || ((1e-6..1e21).contains(&magnitude) && parsed.to_string() == text)
            })
        }
        Value::Array(items) => items.iter().all(canonical_numbers),
        Value::Object(members) => members.values().all(canonical_numbers),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn built_in_bundle() -> Value {
        serde_json::from_str(BUILT_IN_BUNDLE).unwrap()
    }

    #[test]
    fn the_hash_is_the_compilers() {
        let bundle = built_in_bundle();
        assert_eq!(
            bundle_hash(&bundle).as_deref(),
            bundle["hash"].as_str(),
            "the built-in bundle hashes to the hash the compiler wrote"
        );
        let release = json!({"version":bundle["version"],"bundle":bundle["hash"]});
        assert!(matches_release(&bundle, &release));
    }

    /// The bytes the browser's publish uploads (`publishDesignSystem`), written by
    /// `design-system-pages.test.ts`, which fails when they change: a release published today is
    /// accepted.
    #[test]
    fn a_release_from_the_publish_path_is_accepted() {
        let bundle: Value = serde_json::from_str(include_str!(
            "../../../contracts/vectors/design-release-bundle-v1.json"
        ))
        .unwrap();
        let release = json!({"version":bundle["version"],"bundle":bundle["hash"]});
        assert!(matches_release(&bundle, &release));
    }

    #[test]
    fn a_bundle_whose_bytes_do_not_hash_to_its_pin_is_refused() {
        let bundle = built_in_bundle();
        let release = json!({"version":bundle["version"],"bundle":bundle["hash"]});
        // Changed content under the declared hash: the record and the declared hash still agree.
        let mut edited = bundle.clone();
        edited["name"] = json!("Someone else");
        assert!(!matches_release(&edited, &release));
        // Reordered keys hash differently, as in the renderer.
        let mut reordered = serde_json::Map::new();
        let members = bundle.as_object().unwrap();
        for (key, value) in members.iter().rev() {
            reordered.insert(key.clone(), value.clone());
        }
        assert!(!matches_release(&Value::Object(reordered), &release));
        // A declared hash that differs from the record.
        let mut declared = bundle.clone();
        declared["hash"] = json!("sha256-00");
        assert!(!matches_release(&declared, &release));
    }

    #[test]
    fn numbers_hash_only_as_javascript_writes_them() {
        for (text, canonical) in [
            ("1", true),
            ("0", true),
            ("-2", true),
            ("0.5", true),
            ("1.0", false),
            ("-0", true),
            ("1e3", false),
            ("1e21", false),
            ("12345678901234567890", false),
        ] {
            // `-0` is read as 0 and written `0`, as JavaScript writes it.
            let value: Value = serde_json::from_str(&format!("{{\"n\":{text}}}")).unwrap();
            assert_eq!(canonical_numbers(&value), canonical, "{text}");
        }
    }
}
