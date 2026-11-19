//! Validate component markup against the same generated release used by the page frame.
use std::sync::LazyLock;

use serde_json::Value;

use super::{
    Finding, Report, Severity,
    tree::{Id, Tree},
};
use crate::design_bundle::BUILT_IN_BUNDLE;

static RELEASE: LazyLock<Value> =
    LazyLock::new(|| serde_json::from_str(BUILT_IN_BUNDLE).expect("generated design release"));
static PAGE_ELEMENTS: LazyLock<Vec<String>> = LazyLock::new(|| {
    #[derive(serde::Deserialize)]
    struct Host {
        elements: Vec<String>,
    }
    serde_json::from_str::<Host>(include_str!(
        "../../../../contracts/vectors/page-elements-v1.json"
    ))
    .expect("Colab page elements")
    .elements
});

#[derive(serde::Deserialize)]
struct SharedAttributes {
    names: Vec<String>,
    prefixes: Vec<String>,
}

impl SharedAttributes {
    fn accepts(&self, attribute: &str) -> bool {
        self.names.iter().any(|name| attribute == name)
            || self.prefixes.iter().any(|prefix| {
                attribute
                    .strip_prefix(prefix)
                    .is_some_and(|suffix| !suffix.is_empty())
            })
    }
}

static SHARED: LazyLock<Option<SharedAttributes>> = LazyLock::new(|| {
    RELEASE.get("sharedAttributes").map(|table| {
        serde_json::from_value(table.clone()).expect("generated shared attribute table")
    })
});

/// Suggest a unique nearest component within two single-character edits.
fn nearest<'a>(tag: &str, prefix: &str, components: &'a [Value]) -> Option<&'a str> {
    let name = tag.strip_prefix(prefix)?;
    if !name.is_ascii() || name.len() > 64 {
        return None;
    }
    let mut best = 3;
    let mut suggestion = None;
    for candidate in components
        .iter()
        .filter_map(|component| component["tag"].as_str())
    {
        let Some(other) = candidate.strip_prefix(prefix) else {
            continue;
        };
        if name.len().abs_diff(other.len()) > 2 {
            continue;
        }
        let mut row: Vec<usize> = (0..=other.len()).collect();
        for (i, a) in name.bytes().enumerate() {
            let mut diagonal = row[0];
            row[0] = i + 1;
            for (j, b) in other.bytes().enumerate() {
                let previous = row[j + 1];
                row[j + 1] = (diagonal + usize::from(a != b))
                    .min(previous + 1)
                    .min(row[j] + 1);
                diagonal = previous;
            }
        }
        let distance = row[other.len()];
        if distance < best {
            best = distance;
            suggestion = Some(candidate);
        } else if distance == best {
            suggestion = None;
        }
    }
    suggestion
}

pub(super) fn check(tree: &Tree, elements: &[(Id, usize)], report: &mut Report) {
    let mut pins = elements
        .iter()
        .copied()
        .filter(|&(id, _)| tree.name(id) == "meta" && tree.attr(id, "name") == Some("tmt-ds"));
    let Some((pin, ordinal)) = pins.next() else {
        return;
    };
    let mut warn = |id, ordinal, code, fix| {
        report.findings.push(Finding {
            element: tree.name(id).to_owned(),
            ordinal,
            id: tree.attr(id, "data-id").map(str::to_owned),
            questions_skipped: None,
            line: tree.line(id),
            severity: Severity::Warning,
            code,
            fix: Some(fix),
        })
    };
    for (extra, ordinal) in pins {
        warn(
            extra,
            ordinal,
            "multiple-ds-pins",
            "Keep one tmt-ds meta element for this page.".to_owned(),
        );
    }
    let content = tree.attr(pin, "content").unwrap_or_default().trim();
    let (system, lock) = content
        .split_once('@')
        .map_or((content, None), |(s, l)| (s, Some(l)));
    if system != RELEASE["system"].as_str().unwrap() {
        return;
    }
    if let Some(lock) = lock {
        let shipped = format!(
            "{}#{}",
            RELEASE["version"].as_str().unwrap(),
            RELEASE["hash"].as_str().unwrap()
        );
        if lock != shipped {
            warn(
                pin,
                ordinal,
                "unknown-ds-release",
                format!(
                    "Use the lockMeta from tmt colab design show {system}, or follow its draft."
                ),
            );
            return;
        }
    }
    let prefix = format!("{}-", RELEASE["prefix"].as_str().unwrap());
    for &(id, ordinal) in elements {
        let tag = tree.name(id);
        if !tag.contains('-') || PAGE_ELEMENTS.iter().any(|own| own == tag) {
            continue;
        }
        let Some(component) = RELEASE["components"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["tag"] == tag)
        else {
            let code = if tag.starts_with(&prefix) {
                "unknown-ds-component"
            } else {
                "ds-prefix-mismatch"
            };
            warn(
                id,
                ordinal,
                code,
                nearest(tag, &prefix, RELEASE["components"].as_array().unwrap()).map_or_else(
                    || {
                        format!(
                            "Replace <{tag}> with a tag listed by tmt colab design show {system}."
                        )
                    },
                    |near| format!("Did you mean <{near}>?"),
                ),
            );
            continue;
        };
        for name in tree.attr_names(id) {
            let Some(prop) = component["props"].get(name) else {
                if SHARED.as_ref().is_some_and(|table| !table.accepts(name)) {
                    warn(
                        id,
                        ordinal,
                        "invalid-ds-prop",
                        format!(
                            "Remove the unknown {name} attribute from <{tag}> or choose a prop listed by tmt colab design show {system}."
                        ),
                    );
                }
                continue;
            };
            let value = tree.attr(id, name).unwrap_or_default();
            if let Some(values) = prop["enum"].as_array() {
                if !values.iter().any(|item| item == value) {
                    let accepted = values
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(", ");
                    warn(
                        id,
                        ordinal,
                        "invalid-ds-prop",
                        format!("<{tag}> received {name}={value:?}. Choose one of {accepted}."),
                    );
                }
            } else if prop["type"] == "boolean" && !value.is_empty() && value != name {
                warn(
                    id,
                    ordinal,
                    "invalid-ds-prop",
                    format!(
                        "<{tag}> received {name}={value:?}. Use the bare attribute, an empty value or {name:?}, or remove it."
                    ),
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn typo_and_enum_repairs_name_the_component_and_rejected_value() {
        let report = crate::page_check::check(r#"<meta name="tmt-ds" content="tmt-gui"><tmt-ui-buton></tmt-ui-buton><tmt-ui-button variant="garbage"></tmt-ui-button><tmt-ui-completely-unrelated></tmt-ui-completely-unrelated>"#).unwrap();
        assert_eq!(report.findings.len(), 3);
        assert_eq!(
            report.findings[0].fix.as_deref(),
            Some("Did you mean <tmt-ui-button>?")
        );
        let repair = report.findings[1].fix.as_deref().unwrap();
        assert!(repair.contains("variant=\"garbage\""));
        assert!(repair.contains("default, outline, secondary, ghost, destructive, link"));
        assert!(
            !report.findings[2]
                .fix
                .as_deref()
                .unwrap()
                .contains("Did you mean")
        );
    }

    #[test]
    fn duplicate_meta_and_unavailable_lock_name_the_line_and_recovery() {
        for (second, code) in [
            (
                "<meta name=tmt-ds content=tmt-gui>\n<meta name=tmt-ds content=tmt-gui>",
                "multiple-ds-pins",
            ),
            (
                "<p>Title</p>\n<meta name=tmt-ds content=tmt-gui@9.9.9#bad>",
                "unknown-ds-release",
            ),
        ] {
            let report = crate::page_check::check(second).unwrap();
            assert_eq!(report.findings.len(), 1);
            let finding = &report.findings[0];
            assert_eq!((finding.line, finding.code), (2, code));
            assert!(finding.fix.is_some());
        }
    }

    #[test]
    fn component_cases_match_the_frame() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../../../contracts/vectors/design-component-check-v1.json"
        ))
        .unwrap();
        for case in cases {
            let tag = case["tag"].as_str().unwrap();
            let attrs = case["attrs"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(name, value)| format!(" {name}=\"{}\"", value.as_str().unwrap()))
                .collect::<String>();
            let source =
                format!("<meta name=\"tmt-ds\" content=\"tmt-gui\">\n<{tag}{attrs}></{tag}>");
            let report = crate::page_check::check(&source).unwrap();
            let codes = report
                .findings
                .iter()
                .map(|finding| {
                    assert_eq!(finding.line, 2);
                    finding.code
                })
                .collect::<Vec<_>>();
            assert_eq!(serde_json::json!(codes), case["codes"], "{source}");
        }
    }
}
