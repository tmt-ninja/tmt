//! The admitted form, encoded in the same field order as the browser.
use crate::page_check::Question;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Form(u8, String, String, Vec<(String, Option<String>)>);

pub(crate) type LegacyForms = std::collections::BTreeMap<(String, String), Option<Form>>;

/// An absent current form preserves the registration's answer while its controls are removed.
/// An absent recorded form is the explicit grandfathered absence, never a wildcard.
pub fn applies(recorded: Option<&str>, current: Option<&str>) -> bool {
    current.is_none() || recorded == current
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnsweredForm {
    pub form: Form,
    pub digest: String,
    pub selection: String,
}

impl AnsweredForm {
    pub fn valid(&self) -> bool {
        self.form.0 == 1
            && matches!(
                self.form.2.as_str(),
                "single" | "multiple" | "short" | "long"
            )
            && self.form.3.len() <= crate::limits::QUESTION_CHOICES
            && self.form.digest() == self.digest
    }
}

impl From<&Question> for Form {
    fn from(question: &Question) -> Self {
        Self(
            1,
            question.title.clone(),
            question.kind.clone(),
            question
                .choices
                .iter()
                .map(|choice| (choice.label.clone(), choice.description.clone()))
                .collect(),
        )
    }
}

impl Form {
    pub fn page_forms(
        source: &str,
        blocks: Option<&serde_json::Value>,
    ) -> std::collections::BTreeMap<String, Self> {
        if let Some(blocks) = blocks.and_then(serde_json::Value::as_object) {
            return blocks
                .iter()
                .filter(|(_, block)| {
                    block["type"] == "question"
                        && block.get("deleted").is_none()
                        && block["parent"]
                            .as_str()
                            .and_then(|id| blocks.get(id))
                            .is_none_or(|parent| parent.get("deleted").is_none())
                })
                .map(|(id, block)| {
                    let kind = block["props"]["kind"].as_str().unwrap_or("single");
                    let choices = block["props"]["choices"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|_| kind != "short")
                        .filter_map(|choice| choice.as_str().map(|label| (label.to_owned(), None)))
                        .collect();
                    (
                        id.clone(),
                        Self(
                            1,
                            block["text"]["s"].as_str().unwrap_or_default().to_owned(),
                            kind.to_owned(),
                            choices,
                        ),
                    )
                })
                .collect();
        }
        crate::page_check::check(source)
            .into_iter()
            .flat_map(|report| report.questions)
            .map(|question| (question.id.clone(), Self::from(&question)))
            .collect()
    }

    pub fn digest(&self) -> String {
        let encoded = serde_json::to_vec(self).expect("form contains only strings and a version");
        Sha256::digest(encoded)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removal_and_restoration_preserve_only_the_recorded_form() {
        let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../../../contracts/vectors/question-form-lifecycle-v1.json"
        ))
        .unwrap();
        for case in cases {
            let recorded = if case["legacy"] == true {
                &case["atUpgrade"]
            } else {
                &case["atSend"]
            };
            let states: Vec<_> = case["current"]
                .as_array()
                .unwrap()
                .iter()
                .map(|current| applies(recorded.as_str(), current.as_str()))
                .collect();
            assert_eq!(
                serde_json::json!(states),
                case["answered"],
                "{}",
                case["name"]
            );
        }
    }
    #[test]
    fn form_digests_match_shared_vectors() {
        let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../../../contracts/vectors/question-form-v1.json"
        ))
        .unwrap();
        for case in cases {
            let form: Form = serde_json::from_value(case["form"].clone()).unwrap();
            assert_eq!(form.digest(), case["sha256"]);
        }
    }
}
