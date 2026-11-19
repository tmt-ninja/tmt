//! Effective question state from the already verified conversation projection. No writes, Ask
//! outcome, author labels, source titles or timestamps establish whether an answer exists.
use super::form::{Form, applies};
use crate::{closed::Result, export::conversations::Conversations};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub fn project(
    registry: &Value,
    view: &Conversations,
    device_writers: &BTreeSet<String>,
    forms: &BTreeMap<String, Form>,
) -> Result<Vec<Value>> {
    super::validate(registry)?;
    Ok(registry
        .as_array()
        .expect("validated registry")
        .iter()
        .map(|entry| {
            let current = forms.get(entry["id"].as_str().unwrap_or_default()).map(Form::digest);
            let comments = view
                .threads
                .iter()
                .filter(|thread| !thread.deleted)
                .flat_map(|thread| &thread.comments)
                .filter(|comment| {
                    !comment.deleted
                        && device_writers.contains(&comment.writer)
                        && comment.question_id.as_deref() == entry["id"].as_str()
                });
            let mut answer = None;
            let mut previous = None;
            for comment in comments {
                let slot = if comment.answered_form.as_ref().is_none_or(|record|
                    applies(Some(&record.digest), current.as_deref())) { &mut answer } else { &mut previous };
                let order = |c: &crate::export::conversations::Comment| (c.sequence.parse::<u64>().unwrap_or(0), c.writer.clone(), c.id.clone());
                if slot.is_none_or(|older| order(older) < order(comment)) {
                    *slot = Some(comment);
                }
            }
            let mut effective = entry.clone();
            if let Some(comment) = previous {
                effective["earlierAnswer"] = json!({"answeredForm":comment.answered_form,"answerRef":{"writer":comment.writer,"id":comment.id,"revision":comment.revision}});
            }
            if let Some(answer) = answer {
                if effective["state"] == "open" {
                    effective["state"] = json!("answered");
                }
                let summary = crate::summary_passages::excerpt(
                    answer.answered_form.as_ref().map_or(answer.body.as_str(), |record| record.selection.as_str()),
                    crate::limits::QUESTION_ANSWER_POINTS,
                );
                effective["answer"] = json!(summary);
                effective["answeredAt"] = json!(answer.at);
                effective["answerRef"] =
                    json!({"writer":answer.writer,"id":answer.id,"revision":answer.revision});
            }
            effective
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verified_answer_states_and_per_question_counts_match_shared_vectors() {
        let corpus: Value = serde_json::from_str(include_str!(
            "../../../../contracts/vectors/question-answers-v1.json"
        ))
        .unwrap();
        for case in corpus["cases"].as_array().unwrap() {
            let view = crate::summary_pending::tests::view(case);
            let writers = case["deviceWriters"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap().to_owned())
                .collect();
            let actual = project(&case["registry"], &view, &writers, &BTreeMap::new()).unwrap();
            assert_eq!(
                serde_json::to_value(&actual).unwrap(),
                case["expected"],
                "{}",
                case["name"]
            );
            let (report, anchors) = crate::page_check::summary("", &view.threads).unwrap();
            let pending =
                crate::summary_pending::items(&report, &anchors, &view, &writers, Some(&actual));
            let ids: Vec<_> = pending.iter().map(|item| item.id.clone()).collect();
            assert_eq!(
                serde_json::to_value(ids).unwrap(),
                case["pending"],
                "{}",
                case["name"]
            );
        }
    }
}
