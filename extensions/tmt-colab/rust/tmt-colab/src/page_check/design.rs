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
                format!("Replace <{tag}> with a tag listed by tmt colab design show {system}."),
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
                        format!("Set {name} on <{tag}> to one of {accepted}."),
                    );
                }
            } else if prop["type"] == "boolean" && !value.is_empty() && value != name {
                warn(
                    id,
                    ordinal,
                    "invalid-ds-prop",
                    format!("Write {name} as a bare boolean attribute on <{tag}> or remove it."),
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
