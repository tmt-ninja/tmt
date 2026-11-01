use super::*;
fn candidates() -> Vec<Candidate> {
    [("agent:1", "agent", "core"), ("squad:2", "squad", "core")]
        .into_iter()
        .map(|(id, kind, label)| Candidate {
            id: id.into(),
            kind: kind.into(),
            label: label.into(),
            insertion: format!("@{label}"),
        })
        .collect()
}
#[test]
fn completion_replaces_only_the_query_and_preserves_candidate_identity() {
    let mut editor = Editor::from("hello @co");
    let mut completion = Completion::default();
    completion.update(&editor, &candidates(), "@");
    assert!(completion.open());
    assert_eq!(completion.matches.len(), 2);
    completion.move_by(1);
    completion.update(&editor, &candidates(), "@");
    assert_eq!(completion.matches[completion.selected].id, "squad:2");
    assert!(completion.accept(&mut editor, 100));
    assert_eq!(editor.as_str(), "hello @core ");
    assert!(!completion.open());
}
#[test]
fn dismiss_no_matches_and_overflow_never_change_source() {
    let mut editor = Editor::from("@unknown");
    let mut completion = Completion::default();
    completion.update(&editor, &candidates(), "@");
    assert!(completion.open() && completion.matches.is_empty());
    assert!(!completion.accept(&mut editor, 100));
    completion.dismiss(&editor);
    completion.update(&editor, &candidates(), "@");
    assert!(!completion.open());
    editor = "@c".into();
    completion.update(&editor, &candidates(), "@");
    assert!(!completion.accept(&mut editor, 2));
    assert_eq!(editor.as_str(), "@c");
    assert!(completion.open());
}
#[test]
fn emails_and_folded_source_do_not_open_completion() {
    for text in ["name@example", "word@@core", "plain"] {
        let mut completion = Completion::default();
        completion.update(&text.into(), &candidates(), "@");
        assert!(!completion.open());
    }
    let mut editor = Editor::default();
    editor.insert_folded("@core", "[source]".into(), 100);
    let mut completion = Completion::default();
    completion.update(&editor, &candidates(), "@");
    assert!(!completion.open());
}

fn named_candidates(labels: &[&str]) -> Vec<Candidate> {
    labels
        .iter()
        .map(|label| Candidate {
            id: (*label).into(),
            kind: "agent".into(),
            label: (*label).into(),
            insertion: format!("@{label}"),
        })
        .collect()
}

#[test]
fn fuzzy_completion_ignores_separators_and_keeps_unicode_names() {
    for (query, label) in [
        ("ux1", "ux-1"),
        ("rvmp", "ux-revamp"),
        ("coreops", "core-ops"),
        ("nl", "night-lead"),
        ("tul", "tmt-ux-lead"),
        ("UX1", "ux_1"),
        ("é班", "Équipe.班"),
    ] {
        let editor = Editor::from(format!("hello @{query}"));
        let mut completion = Completion::default();
        completion.update(&editor, &named_candidates(&[label]), "@");
        assert_eq!(completion.matches.len(), 1, "{query} should match {label}");
    }
}

#[test]
fn fuzzy_completion_ranks_matches_and_keeps_inventory_order_on_ties() {
    let mut completion = Completion::default();
    completion.update(
        &Editor::from("@abc"),
        &named_candidates(&[
            "azbzc",
            "xxabcxx",
            "alpha beta charlie",
            "a-b-c-tail",
            "abc",
            "axbyc",
            "unrelated",
        ]),
        "@",
    );
    assert_eq!(
        completion
            .matches
            .iter()
            .map(|c| c.label.as_str())
            .collect::<Vec<_>>(),
        [
            "abc",
            "a-b-c-tail",
            "alpha beta charlie",
            "xxabcxx",
            "azbzc",
            "axbyc"
        ]
    );
}

#[test]
fn fuzzy_highlights_are_label_source_ranges_and_clear_with_the_picker() {
    for (query, label, marked) in [
        ("ux1", "u-x_1", "ux1"),
        ("tul", "tmt-ux-lead", "tul"),
        ("é班", "Équipe.班", "É班"),
        ("i", "İpek", "İ"),
    ] {
        let mut editor = Editor::from(format!("@{query}"));
        let mut completion = Completion::default();
        completion.update(&editor, &named_candidates(&[label]), "@");
        let highlighted: String = completion
            .matched_ranges(0)
            .iter()
            .map(|range| &label[range.clone()])
            .collect();
        assert_eq!(highlighted, marked);
        assert!(completion.accept(&mut editor, 100));
        assert_eq!(editor.as_str(), format!("@{label} "));
        assert!(completion.matched_ranges(0).is_empty());
    }
    let editor = Editor::from("@ux1");
    let mut completion = Completion::default();
    completion.update(&editor, &named_candidates(&["ux-1"]), "@");
    completion.dismiss(&editor);
    assert!(completion.matched_ranges(0).is_empty());
    completion.update(&Editor::from("plain"), &named_candidates(&["ux-1"]), "@");
    assert!(completion.matched_ranges(0).is_empty());
}

#[test]
fn empty_query_preserves_inventory_order_without_highlights() {
    let mut completion = Completion::default();
    completion.update(&Editor::from("@"), &named_candidates(&["z", "", "a"]), "@");
    assert_eq!(
        completion
            .matches
            .iter()
            .map(|c| c.label.as_str())
            .collect::<Vec<_>>(),
        ["z", "", "a"]
    );
    assert!((0..3).all(|at| completion.matched_ranges(at).is_empty()));
}

#[test]
fn the_caller_trigger_opens_the_picker_and_other_prefixes_do_not() {
    let candidates = || {
        vec![Candidate {
            id: "agent:1".into(),
            kind: "agent".into(),
            label: "night-lead".into(),
            insertion: "tmt/night-lead".into(),
        }]
    };
    let mut completion = Completion::default();
    let mut editor = Editor::from("ask tmt/ni");
    completion.update(&editor, &candidates(), "tmt/");
    assert!(completion.open());
    assert!(completion.accept(&mut editor, usize::MAX));
    assert_eq!(editor.as_str(), "ask tmt/night-lead ");
    for text in [
        "ask @ni",
        "see ~/.config/tmt/ni",
        "github.com/tmt-ninja/tmt/ni",
        "tmt/a/tmt/ni",
    ] {
        completion.update(&Editor::from(text), &candidates(), "tmt/");
        assert!(!completion.open(), "{text}");
    }
    completion.update(&Editor::from("ask tmt/ni"), &candidates(), "");
    assert!(!completion.open(), "an empty trigger never opens");
}
#[test]
fn grouped_matches_stay_in_inventory_groups_and_details_match_after_labels() {
    let inventory: Vec<(Candidate, String)> = [
        ("tmt", "tmt-colab", "Create and update Colab pages"),
        ("tmt", "tmt-ops", "Read the squad board"),
        ("user", "code-review", "Review the current diff"),
        ("project", "tmt-dev", "Development workflow for this repo"),
    ]
    .into_iter()
    .map(|(kind, label, detail)| {
        (
            Candidate {
                id: format!("skill:{label}"),
                kind: kind.into(),
                label: label.into(),
                insertion: format!("/{label}"),
            },
            detail.to_owned(),
        )
    })
    .collect();
    let mut completion = Completion::default();
    let ids = |completion: &Completion| {
        completion
            .matches
            .iter()
            .map(|candidate| candidate.label.clone())
            .collect::<Vec<_>>()
    };
    // An empty query lists every group in inventory order.
    completion.update_grouped(&Editor::from("/"), &inventory, "/");
    assert_eq!(
        ids(&completion),
        ["tmt-colab", "tmt-ops", "code-review", "tmt-dev"]
    );
    // Groups keep their order whatever the rank: a better `code-review` match stays after
    // `tmt-colab`.
    completion.update_grouped(&Editor::from("ask /co"), &inventory, "/");
    assert_eq!(ids(&completion), ["tmt-colab", "code-review"]);
    // A description-only match counts, with no emphasis in the label.
    completion.update_grouped(&Editor::from("/board"), &inventory, "/");
    assert_eq!(ids(&completion), ["tmt-ops"]);
    assert!(completion.matched_ranges(0).is_empty());
    // A second trigger inside the token is a path, not a query.
    completion.update_grouped(&Editor::from("/usr/bin"), &inventory, "/");
    assert!(!completion.open());
}
