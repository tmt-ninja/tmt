//! The #485 interaction guard: whether a person can see a view or answer a
//! question is decided once, by `tmt_cli_style::Interaction`. The CLI crates
//! never test a handle with `is_terminal` or import `IsTerminal` themselves.
//! `design/cli-style.md` owns the rule; this is its syntactic check.

use super::{
    output::GUARDED,
    source::{Source, production, production_impl, production_trait},
};
use std::collections::BTreeSet;
use syn::visit::{self, Visit};

/// Files that still decide interactivity on their own. Later #485 slices move
/// core; the list only shrinks.
pub const MIGRATING: &[(&str, &str)] =
    &[("tmt-cli", "consent.rs"), ("tmt-cli", "skill_reminder.rs")];

/// Ordinary commands already migrated to paired reports. Extend with each batch.
const REPORT_COMMANDS: &[&str] = &[
    "binding_command.rs",
    "identity_command.rs",
    "profile_command.rs",
    "room_command.rs",
    "room_command/dispatch.rs",
    "context_command.rs",
    "context_command/presentation.rs",
    "discovery_command.rs",
    "config_command.rs",
    "init_command.rs",
    "notes_command.rs",
];

pub fn report_violations(sources: &[Source]) -> Vec<String> {
    let mut violations = Vec::new();
    for source in sources.iter().filter(|source| {
        source.package == "tmt-cli" && REPORT_COMMANDS.contains(&source.file.as_str())
    }) {
        let mut visitor = ReportVisitor { bypass: false };
        visitor.visit_file(&source.syntax);
        if visitor.bypass {
            violations.push(format!(
                "tmt-cli/{}: migrated command bypasses CliOutput",
                source.file
            ));
        }
    }
    violations
}

struct ReportVisitor {
    bypass: bool,
}

impl<'ast> Visit<'ast> for ReportVisitor {
    fn visit_item(&mut self, item: &'ast syn::Item) {
        if production(item) {
            visit::visit_item(self, item);
        }
    }
    fn visit_expr_field(&mut self, field: &'ast syn::ExprField) {
        if matches!(&field.member, syn::Member::Named(name) if name == "json") {
            self.bypass = true;
        }
        visit::visit_expr_field(self, field);
    }
    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        if call.method == "publish" || call.method == "is_terminal" {
            self.bypass = true;
        }
        visit::visit_expr_method_call(self, call);
    }
    fn visit_path(&mut self, path: &'ast syn::Path) {
        if path.segments.iter().any(|part| {
            part.ident == "OutputMode" || part.ident == "CliOutput" || part.ident == "stream"
        }) {
            self.bypass = true;
        }
        visit::visit_path(self, path);
    }
}

/// Files in the guarded crates that test a terminal themselves.
pub fn findings(sources: &[Source]) -> BTreeSet<(String, String)> {
    let mut found = BTreeSet::new();
    for source in sources
        .iter()
        .filter(|source| GUARDED.contains(&source.package.as_str()))
    {
        let mut visitor = Visitor { hit: false };
        visitor.visit_file(&source.syntax);
        if visitor.hit {
            found.insert((source.package.clone(), source.file.clone()));
        }
    }
    found
}

/// An unlisted file that decides for itself, or a listed file that no longer
/// does and should leave the list.
pub fn violations(sources: &[Source], migrating: &[(&str, &str)]) -> Vec<String> {
    let found = findings(sources);
    let listed: BTreeSet<(String, String)> = migrating
        .iter()
        .map(|(package, file)| ((*package).to_owned(), (*file).to_owned()))
        .collect();
    let mut violations: Vec<String> = found
        .difference(&listed)
        .map(|(package, file)| {
            format!("{package}/{file}: tests a terminal itself; use tmt_cli_style::Interaction")
        })
        .collect();
    violations.extend(listed.difference(&found).map(|(package, file)| {
        format!("{package}/{file}: no longer tests a terminal; remove it from the interaction migration list")
    }));
    violations
}

struct Visitor {
    hit: bool,
}

impl<'ast> Visit<'ast> for Visitor {
    fn visit_item(&mut self, item: &'ast syn::Item) {
        if production(item) {
            visit::visit_item(self, item);
        }
    }

    fn visit_impl_item(&mut self, item: &'ast syn::ImplItem) {
        if production_impl(item) {
            visit::visit_impl_item(self, item);
        }
    }

    fn visit_trait_item(&mut self, item: &'ast syn::TraitItem) {
        if production_trait(item) {
            visit::visit_trait_item(self, item);
        }
    }

    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        if call.method == "is_terminal" {
            self.hit = true;
        }
        visit::visit_expr_method_call(self, call);
    }

    fn visit_ident(&mut self, ident: &'ast proc_macro2::Ident) {
        if ident == "IsTerminal" {
            self.hit = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(package: &str, file: &str, text: &str) -> Source {
        Source {
            package: package.into(),
            file: file.into(),
            syntax: syn::parse_file(text).unwrap(),
        }
    }

    #[test]
    fn migrated_reports_cannot_branch_on_mode_or_publish_directly() {
        for text in [
            "fn f(mode: OutputMode) { if mode.json {} }",
            "fn f(error: Failure) { error.publish(mode); }",
            "fn f() { tmt_cli_style::stream::stdout(false); }",
            "fn f() { CliOutput::new(false); }",
        ] {
            assert_eq!(
                report_violations(&[source("tmt-cli", "init_command.rs", text)]).len(),
                1,
                "{text}"
            );
        }
        assert!(
            report_violations(&[source(
                "tmt-cli",
                "init_command.rs",
                "fn f() -> Report { Report } "
            )])
            .is_empty()
        );
    }

    #[test]
    fn a_handle_test_outside_the_style_layer_is_found_and_the_list_stays_exact() {
        let sources = [
            source(
                "tmt-ops",
                "board.rs",
                "fn f() -> bool { std::io::stdout().is_terminal() }",
            ),
            source("tmt-ops", "consent.rs", "use std::io::IsTerminal;"),
            source(
                "tmt-ops",
                "tests_only.rs",
                "#[cfg(test)] fn f() -> bool { std::io::stdin().is_terminal() }",
            ),
            source(
                "tmt-cli-style",
                "interaction.rs",
                "fn f() -> bool { std::io::stdin().is_terminal() }",
            ),
            source(
                "tmt-ops",
                "main.rs",
                "fn f(i: Interaction) -> Mode { i.view() }",
            ),
        ];
        assert_eq!(
            violations(
                &sources,
                &[("tmt-ops", "consent.rs"), ("tmt-cli", "gone.rs")]
            ),
            [
                "tmt-ops/board.rs: tests a terminal itself; use tmt_cli_style::Interaction",
                "tmt-cli/gone.rs: no longer tests a terminal; remove it from the interaction migration list",
            ]
        );
    }
}
