//! A mockup block draws its `markup` in a frame, so the markup must pass the page check as a page's
//! source does: the mockups a batch adds, or whose markup it changes, are checked with
//! `page_check::check` and refused when it has any finding. The parent admits it before the
//! decoder is asked to prepare the batch (as it checks an HTML page's source), so the isolated
//! decoder and both folds take the stored value as it is.
use super::ops::Refusal;
use serde_json::Value;

fn markup(block: &Value) -> Option<&str> {
    (block["type"] == "mockup" && block.get("deleted").is_none())
        .then(|| block["props"]["markup"].as_str())
        .flatten()
}

/// `Ok` when every new or changed mockup in `next` passes the page check.
pub fn check(before: &Value, next: &Value) -> Result<(), Refusal> {
    let Some(next) = next.as_object() else {
        return Ok(());
    };
    for (id, block) in next {
        let Some(source) = markup(block) else {
            continue;
        };
        if before.get(id).and_then(markup) == Some(source) {
            continue;
        }
        let report = crate::page_check::check(source).map_err(|_| Refusal::Capacity)?;
        if !report.findings.is_empty() {
            return Err(Refusal::Markup);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn page(markup: &str) -> Value {
        json!({"m": {"type": "mockup", "parent": "root", "pos": "V", "props": {"markup": markup}}})
    }

    #[test]
    fn clean_markup_passes_and_an_unchanged_mockup_is_not_rechecked() {
        assert_eq!(
            check(
                &json!({}),
                &page("<tmt-card title=\"A\"><p>Hi</p></tmt-card>")
            ),
            Ok(())
        );
        // A stored mockup stays admitted when only something else changes.
        let bad = page("<tmt-question data-id=\"nope\" data-kind=\"single\"></tmt-question>");
        assert_eq!(check(&bad, &bad), Ok(()));
    }

    #[test]
    fn markup_the_page_check_flags_is_refused() {
        let bad = page("<tmt-question data-id=\"nope\" data-kind=\"single\"></tmt-question>");
        assert_eq!(check(&json!({}), &bad), Err(Refusal::Markup));
        // Changing a stored mockup to flagged markup is refused too.
        assert_eq!(check(&page("<p>ok</p>"), &bad), Err(Refusal::Markup));
    }
}
