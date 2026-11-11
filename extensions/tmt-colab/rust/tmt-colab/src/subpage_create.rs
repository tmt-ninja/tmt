//! A sub-page made from a title, shared by `tmt colab subpage create` and the serve's browser
//! `subpage.create`: the title it takes, the first text of the page, and the page ID a browser's
//! operation derives, so one operation can never make two pages.
use crate::closed::{Invalid, nonempty};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// The title of a new sub-page: inert, non-empty text within the page title bound.
pub fn title(value: &Value) -> crate::closed::Result<&str> {
    let title = nonempty(value, crate::limits::PAGE_TITLE_BYTES)?.trim();
    if title.is_empty() {
        return Err(Invalid);
    }
    Ok(title)
}

/// Admit the entire ordered batch before making any page.
pub fn batch(value: &Value) -> crate::closed::Result<(Vec<String>, bool)> {
    crate::closed::keys(value, &["titles"], &["format"])?;
    if serde_json::to_vec(value).map_err(|_| Invalid)?.len() > crate::limits::SUBPAGE_BATCH_BYTES {
        return Err(Invalid);
    }
    let titles = value["titles"].as_array().ok_or(Invalid)?;
    if titles.is_empty() || titles.len() > crate::limits::SUBPAGE_BATCH_ENTRIES {
        return Err(Invalid);
    }
    let html = match value.get("format") {
        None => false,
        Some(value) if value.as_str() == Some("html") => true,
        _ => return Err(Invalid),
    };
    Ok((
        titles
            .iter()
            .map(|value| title(value).map(str::to_owned))
            .collect::<crate::closed::Result<_>>()?,
        html,
    ))
}

/// Stable per-entry operation ID, separated by space, batch and zero-based input index.
pub fn batch_operation_id(space: &str, batch_id: &str, index: usize) -> String {
    named_id(
        b"tmt-colab/subpage-batch-entry/v1\0",
        space,
        &format!("{batch_id}:{index}"),
    )
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
/// The first text of a new sub-page: its title as the heading, escaped, and nothing else.
pub fn child_source(title: &str) -> String {
    format!("<h1>{}</h1>\n", escape_html(title))
}

/// The page a browser's create operation makes: a name-based ID over the space and the operation,
/// in the shape of a generated ID. The same operation always names the same page, so a lost reply
/// is answered by asking whether that page exists, and a replay finds its page instead of making
/// another. A new operation names a new page.
pub fn child_page_id(space: &str, operation_id: &str) -> String {
    named_id(b"tmt-colab/convert/v1\0", space, operation_id)
}
/// The ID the page creation itself is recorded under. It cannot be the browser's operation ID: the
/// link is recorded under that one, and the owner store keeps one outcome per operation ID.
pub fn create_operation_id(space: &str, operation_id: &str) -> String {
    named_id(b"tmt-colab/convert-create/v1\0", space, operation_id)
}
fn named_id(domain: &[u8], space: &str, operation_id: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(domain);
    hash.update(space.as_bytes());
    hash.update([0]);
    hash.update(operation_id.as_bytes());
    let digest = hash.finalize();
    let mut b = [0u8; 16];
    b.copy_from_slice(&digest[..16]);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    let h: String = b.iter().map(|v| format!("{v:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &h[..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..]
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_title_is_inert_non_empty_text() {
        assert_eq!(title(&json!("  Launch plan ")).unwrap(), "Launch plan");
        for bad in [
            json!(""),
            json!("   "),
            json!("a\nb"),
            json!(7),
            json!("x".repeat(513)),
        ] {
            assert!(title(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn batch_admits_every_title_before_effects_in_input_order() {
        assert_eq!(
            batch(&json!({"titles":[" One ","One","Two"],"format":"html"})).unwrap(),
            (
                vec!["One".to_owned(), "One".to_owned(), "Two".to_owned()],
                true
            )
        );
        assert!(!batch(&json!({"titles":["One"]})).unwrap().1);
        for bad in [
            json!({"titles":[]}),
            json!({"titles":["good", " "]}),
            json!({"titles":["good"],"format":"blocks"}),
            json!({"titles":["good"],"extra":true}),
            json!({"titles":vec!["x"; crate::limits::SUBPAGE_BATCH_ENTRIES + 1]}),
            json!({"titles":vec!["\\".repeat(512); 128]}),
        ] {
            assert!(batch(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn batch_entry_ids_are_repeatable_and_distinct() {
        let space = "s".repeat(43);
        let batch = "60000000-0000-4000-8000-000000000001";
        let first = batch_operation_id(&space, batch, 0);
        assert_eq!(first, "be0edf8b-8d0d-4bbe-8f7a-2eeecd051262");
        assert_eq!(
            batch_operation_id(&space, batch, 1),
            "296e871d-9331-40d8-a8c1-1ee1afb459f6"
        );
        assert_eq!(first, batch_operation_id(&space, batch, 0));
        assert_ne!(first, batch_operation_id(&space, batch, 1));
        assert_ne!(first, batch_operation_id(&"t".repeat(43), batch, 0));
        assert_ne!(
            first,
            batch_operation_id(&space, "60000000-0000-4000-8000-000000000002", 0)
        );
        tmt_colab_model::values::generated_id(&first).unwrap();
    }

    #[test]
    fn the_first_text_is_the_escaped_title() {
        assert_eq!(
            child_source("A <b> & \"c\""),
            "<h1>A &lt;b&gt; &amp; &quot;c&quot;</h1>\n"
        );
    }

    #[test]
    fn an_operation_names_one_page_in_the_shape_of_a_generated_id() {
        let space = "s".repeat(43);
        let op = "60000000-0000-4000-8000-000000000001";
        let page = child_page_id(&space, op);
        assert_eq!(page, child_page_id(&space, op));
        assert_ne!(
            page,
            child_page_id(&space, "60000000-0000-4000-8000-000000000002")
        );
        assert_ne!(page, child_page_id(&"t".repeat(43), op));
        tmt_colab_model::values::generated_id(&page).unwrap();
        assert_ne!(page, create_operation_id(&space, op));
    }
}
