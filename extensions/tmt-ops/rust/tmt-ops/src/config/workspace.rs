//! The effective workspace action table. Dispatch, footer and help consume the same
//! result after default/global/host/section precedence, never independent hints.
use super::*;
use crate::action::{Action, OpsUiAction, Verb};
use std::collections::BTreeSet;

mod panels;
pub use panels::{
    DigestPanel, DigestPanels, OverviewPanel, OverviewPanels, Panel, PanelSetting, Panels,
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum OpsSort {
    #[default]
    Name,
    Attention,
    Members,
}

impl OpsSort {
    pub fn next(self) -> Self {
        match self {
            Self::Name => Self::Attention,
            Self::Attention => Self::Members,
            Self::Members => Self::Name,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverviewColumn {
    Agent,
    Squad,
    State,
    TokensPerHour,
    Digest,
    Cron,
    Runtime,
    Model,
}

impl OverviewColumn {
    pub const ALL: [Self; 8] = [
        Self::Agent,
        Self::Squad,
        Self::State,
        Self::TokensPerHour,
        Self::Digest,
        Self::Cron,
        Self::Runtime,
        Self::Model,
    ];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverviewDirection {
    Ascending,
    Descending,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum TokRange {
    #[default]
    Hour,
    ThreeHours,
    SixHours,
    Day,
    Week,
    /// Digest-only range; not offered by the Agents controls.
    Month,
}

impl TokRange {
    pub const ALL: [Self; 5] = [
        Self::Hour,
        Self::ThreeHours,
        Self::SixHours,
        Self::Day,
        Self::Week,
    ];

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|range| range.argument() == value)
    }

    pub fn argument(self) -> &'static str {
        match self {
            Self::Hour => "1h",
            Self::ThreeHours => "3h",
            Self::SixHours => "6h",
            Self::Day => "1d",
            Self::Week => "7d",
            Self::Month => "30d",
        }
    }

    pub fn caption(self) -> &'static str {
        match self {
            Self::Hour => "TOK 1h",
            Self::ThreeHours => "TOK 3h",
            Self::SixHours => "TOK 6h",
            Self::Day => "TOK 1d",
            Self::Week => "TOK 7d",
            Self::Month => "TOK 30d",
        }
    }

    /// The caption while the column shows money: the same range word after `≈$`.
    pub fn caption_money(self) -> &'static str {
        match self {
            Self::Hour => "≈$ 1h",
            Self::ThreeHours => "≈$ 3h",
            Self::SixHours => "≈$ 6h",
            Self::Day => "≈$ 1d",
            Self::Week => "≈$ 7d",
            Self::Month => "≈$ 30d",
        }
    }

    /// The caption of the TOK column in the unit it shows.
    pub fn caption_in(self, money: bool) -> &'static str {
        if money {
            self.caption_money()
        } else {
            self.caption()
        }
    }

    pub fn milliseconds(self) -> u64 {
        match self {
            Self::Hour => 3_600_000,
            Self::ThreeHours => 10_800_000,
            Self::SixHours => 21_600_000,
            Self::Day => 86_400_000,
            Self::Week => 604_800_000,
            Self::Month => 2_592_000_000,
        }
    }

    pub fn next(self) -> Self {
        match self {
            Self::Hour => Self::ThreeHours,
            Self::ThreeHours => Self::SixHours,
            Self::SixHours => Self::Day,
            Self::Day => Self::Week,
            Self::Week | Self::Month => Self::Hour,
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct OpsPreferences {
    pub hidden: BTreeSet<String>,
    pub sort: OpsSort,
    pub reversed: bool,
    pub layout: OpsLayout,
    pub tok_range: TokRange,
    pub savings_unit: super::SavingsUnit,
    pub overview_panels: Option<PanelSetting<OverviewPanel>>,
    pub digest_panels: Option<PanelSetting<DigestPanel>>,
    pub labels: WorkspaceLabels,
}

/// The person's board labels; these never become agent or Core metadata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoardLabel {
    pub id: String,
    pub glyph: String,
    pub color: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceLabels {
    pub definitions: Vec<BoardLabel>,
    pub members: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LabelEdit {
    Upsert(BoardLabel),
    Move { id: String, index: usize },
    Delete { id: String },
}

impl Default for WorkspaceLabels {
    fn default() -> Self {
        let definitions = [
            ("pr", "P", "waiting", "PR"),
            ("review", "R", "unread", "review"),
            ("waiting", "W", "muted", "waiting"),
            ("blocked", "!", "blocked", "blocked"),
            ("watch", "★", "working", "watch"),
        ]
        .into_iter()
        .map(|(id, glyph, color, name)| BoardLabel {
            id: id.into(),
            glyph: glyph.into(),
            color: color.into(),
            name: name.into(),
        })
        .collect();
        Self {
            definitions,
            members: BTreeMap::new(),
        }
    }
}

pub(crate) fn valid_label_glyph(glyph: &str) -> bool {
    tmt_tui::text::is_single_cell_or_wide_grapheme(glyph)
}

fn validate_label(label: &BoardLabel) -> Result<(), SquadError> {
    if label.id.is_empty()
        || label.id.len() > 64
        || !label
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        return Err(invalid(
            "Label IDs use letters, numbers, hyphens or underscores.",
        ));
    }
    if !valid_label_glyph(&label.glyph) {
        return Err(invalid(
            "Use one nonblank character or emoji, one or two cells wide, without joined characters.",
        ));
    }
    if crate::look::role(&label.color).is_none() {
        return Err(invalid("Choose a board palette color."));
    }
    if label.name.trim().is_empty() || label.name.chars().any(char::is_control) {
        return Err(invalid("Label names must be nonblank text."));
    }
    Ok(())
}

fn label_toml(label: &BoardLabel) -> toml_edit::Value {
    let mut table = toml_edit::InlineTable::new();
    table.insert("id", label.id.as_str().into());
    table.insert("glyph", label.glyph.as_str().into());
    table.insert("color", label.color.as_str().into());
    table.insert("name", label.name.as_str().into());
    toml_edit::Value::InlineTable(table)
}

fn canonical_room_id(value: &str) -> bool {
    uuid_like(value) && !value.bytes().any(|byte| byte.is_ascii_uppercase())
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum OpsLayout {
    #[default]
    Auto,
    Side,
    Stack,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum OpsKeyScope {
    Squad,
    Member,
    /// One of a built-in member's extra terminals (#5991).
    Terminal,
    Pool,
    Reader,
    /// The Orchestration tab (#4893): its own controls, with the tab and app keys.
    Orchestration,
}

impl OpsKeyScope {
    pub(crate) const ALL: [Self; 6] = [
        Self::Squad,
        Self::Member,
        Self::Terminal,
        Self::Pool,
        Self::Reader,
        Self::Orchestration,
    ];

    pub(crate) fn is_reader(self) -> bool {
        self == Self::Reader
    }
}

pub struct WorkspaceKeys {
    pub bindings: Bindings,
    /// Provenance follows exactly the admitted default/global/host/section merge.
    pub sources: std::collections::BTreeMap<String, String>,
    pub notices: Vec<String>,
}

pub(crate) fn defaults(scope: OpsKeyScope) -> Bindings {
    let mut entries = if scope == OpsKeyScope::Orchestration {
        vec![
            ("1", "agents"),
            ("2", "digest-dashboard"),
            ("3", "orchestration"),
            ("up", "previous"),
            ("down", "next"),
            ("left", "fold"),
            ("right", "expand"),
            ("home", "first"),
            ("end", "last"),
            ("d", "orchestration-day"),
            ("7", "orchestration-week"),
            ("0", "orchestration-month"),
            ("P", "orchestration-plans"),
            ("N", "orchestration-now"),
            ("[", "orchestration-earlier"),
            ("]", "orchestration-later"),
            ("a", "allow-once"),
            ("f", "focus-hour"),
            ("F", "end-focus"),
            ("r", "release-held"),
            ("w", "why"),
            ("/", "search"),
            ("?", "help"),
            ("q", "quit"),
            ("ctrl-r", "refresh"),
            (",", "settings"),
            ("g", "open-web"),
        ]
    } else if scope.is_reader() {
        vec![
            ("1", "agents"),
            ("2", "digest-dashboard"),
            ("3", "orchestration"),
            ("]", "digest-details"),
            ("up", "scroll-up"),
            ("k", "scroll-up"),
            ("down", "scroll-down"),
            ("j", "scroll-down"),
            ("pageup", "scroll-page-up"),
            ("pagedown", "scroll-page-down"),
            ("home", "scroll-top"),
            ("end", "scroll-bottom"),
            ("tab", "next-pane"),
            ("backtab", "next-pane"),
            ("?", "help"),
            ("q", "quit"),
            ("ctrl-r", "refresh"),
            (",", "settings"),
            ("enter", "talk"),
            ("o", "open"),
            ("D", "digest"),
            ("c", "timers"),
            ("C", "member-checklist"),
            ("T", "pane-talk"),
            ("M", "pane-measure"),
            ("ctrl-g", "member-back"),
        ]
    } else {
        vec![
            ("1", "agents"),
            ("2", "digest-dashboard"),
            ("3", "orchestration"),
            ("up", "previous"),
            ("down", "next"),
            ("left", "fold"),
            ("right", "expand"),
            ("pageup", "page-up"),
            ("pagedown", "page-down"),
            ("home", "first"),
            ("end", "last"),
            ("]", "digest-details"),
            ("enter", "inspect"),
            ("double-click", "inspect"),
            ("/", "search"),
            ("?", "help"),
            ("q", "quit"),
            ("tab", "next-pane"),
            ("backtab", "next-pane"),
            ("ctrl-r", "refresh"),
            ("ctrl-g", "member-back"),
            (",", "settings"),
            ("c", "timers"),
            ("T", "pane-talk"),
            ("M", "pane-measure"),
            ("u", "unread"),
            ("l", "member-label"),
            ("esc", "clear-scope"),
            ("h", "reveal-hidden"),
        ]
    };
    match scope {
        OpsKeyScope::Reader | OpsKeyScope::Orchestration => {}
        OpsKeyScope::Squad => entries.extend([
            ("e", "edit"),
            ("r", "rename"),
            ("j", "jump"),
            ("o", "open"),
            ("D", "digest"),
            ("m", "manage"),
            ("N", "create-squad"),
            ("H", "hide-squad"),
            ("S", "show-squad"),
        ]),
        OpsKeyScope::Member => entries.extend([
            ("e", "edit"),
            ("r", "rename"),
            ("enter", "talk"),
            ("j", "jump"),
            ("o", "open"),
            ("x", "remove-member"),
            ("C", "member-checklist"),
            ("m", "move-membership"),
            ("D", "digest"),
            ("t", "terminal-new"),
        ]),
        OpsKeyScope::Terminal => entries.extend([
            ("t", "terminal-new"),
            ("enter", "terminal-type"),
            ("double-click", "terminal-type"),
            ("j", "terminal-full-screen"),
            ("x", "terminal-close"),
        ]),
        OpsKeyScope::Pool => entries.extend([("m", "manage"), ("N", "create-squad")]),
    }
    if matches!(
        scope,
        OpsKeyScope::Squad | OpsKeyScope::Member | OpsKeyScope::Pool
    ) {
        entries.push(("n", "new-member"));
        entries.push(("s", "discover-agents"));
    }
    if scope != OpsKeyScope::Orchestration {
        entries.extend([
            ("w", "workspace-snapshots"),
            ("g", "open-web"),
            ("y", "copy"),
        ]);
    }
    entries
        .into_iter()
        .map(|(key, action)| {
            (
                key.into(),
                Action::parse(action).expect("admitted default action"),
            )
        })
        .collect()
}

pub(crate) fn admit_action(action: &Action, path: &str) -> Result<(), SquadError> {
    if let Verb::Retired(name) = action.verb {
        let instead = match name {
            "overview" => "the Overview tab was merged into Agents; use 'agents'",
            "overview-view" => "Agents now shows the squad tree",
            _ => "Agents now shows the squad tree",
        };
        return Err(invalid(format!(
            "`{path}`: '{name}' is retired; {instead}. The authored binding is preserved for migration."
        )));
    }
    if matches!(
        action.verb,
        Verb::Toggle
            | Verb::Tab
            | Verb::AskLead
            | Verb::HomeMessage
            | Verb::HomeWrite
            | Verb::HomePick
            | Verb::PickTab
            | Verb::View
            | Verb::Notes
    ) {
        return Err(invalid(format!(
            "`{path}`: '{}' belongs to the retired squad-tab/HOME/notebook layout. Select a squad or named lead/member in the workspace; choose a new binding explicitly.",
            action.text
        )));
    }
    if action.verb == Verb::Jump
        && action
            .args
            .first()
            .and_then(crate::template::Template::literal)
            == Some("lead")
    {
        return Err(invalid(format!(
            "`{path}`: select the named lead row, then bind jump; implicit lead targeting is retired."
        )));
    }
    Ok(())
}
impl Config {
    /// Read the user's explicit definitions and UUID assignments without rewriting TOML.
    pub fn workspace_labels(&self) -> Result<WorkspaceLabels, SquadError> {
        let mut labels = WorkspaceLabels::default();
        let Some(workspace) = self.document.get("workspace") else {
            return Ok(labels);
        };
        let workspace = workspace
            .as_table_like()
            .ok_or_else(|| invalid("`workspace` must be a table."))?;
        let Some(item) = workspace.get("labels") else {
            return Ok(labels);
        };
        let table = item
            .as_table_like()
            .ok_or_else(|| invalid("`workspace.labels` must be a table."))?;
        if let Some(definitions) = table.get("definitions") {
            let definitions = definitions
                .as_array()
                .ok_or_else(|| invalid("Label definitions must be an array."))?;
            if definitions.len() > 32 {
                return Err(invalid("A maximum of 32 labels is allowed."));
            }
            labels.definitions.clear();
            let mut ids = BTreeSet::new();
            for value in definitions {
                let definition = value
                    .as_inline_table()
                    .ok_or_else(|| invalid("Each label must be a table."))?;
                let field = |key| {
                    definition
                        .get(key)
                        .and_then(|value| value.as_str())
                        .ok_or_else(|| invalid(format!("Label {key} must be text.")))
                };
                let id = field("id")?;
                let glyph = field("glyph")?;
                let color = field("color")?;
                let name = field("name")?;
                let label = BoardLabel {
                    id: id.into(),
                    glyph: glyph.into(),
                    color: color.into(),
                    name: name.into(),
                };
                validate_label(&label)?;
                if !ids.insert(label.id.clone()) {
                    return Err(invalid("Each label needs a unique ID."));
                }
                labels.definitions.push(label);
            }
        }
        if let Some(members) = table.get("members") {
            let members = members
                .as_table_like()
                .ok_or_else(|| invalid("Label members must be a table."))?;
            for (id, value) in members.iter() {
                let label = value
                    .as_str()
                    .ok_or_else(|| invalid("Member label IDs must be text."))?;
                if !super::unread::identity(id)
                    || !labels
                        .definitions
                        .iter()
                        .any(|definition| definition.id == label)
                {
                    return Err(invalid(
                        "A member label requires a canonical identity UUID and an existing label ID.",
                    ));
                }
                labels.members.insert(id.into(), label.into());
            }
        }
        Ok(labels)
    }

    /// Change only one assignment after the user explicitly chooses or clears it.
    pub fn save_member_label(
        &mut self,
        expected: &WorkspaceLabels,
        member: &str,
        label: Option<&str>,
    ) -> Result<(), SquadError> {
        if self.workspace_labels()? != *expected {
            return Err(invalid("Labels changed; reload before saving."));
        }
        if !super::unread::identity(member)
            || label.is_some_and(|id| {
                !expected
                    .definitions
                    .iter()
                    .any(|definition| definition.id == id)
            })
        {
            return Err(invalid("Choose a member and an existing label."));
        }
        if expected.members.get(member).map(String::as_str) == label {
            return Ok(());
        }
        self.write(|document| {
            if document.get("workspace").is_none() {
                document["workspace"] = Item::Table(Table::new());
            }
            if document["workspace"].get("labels").is_none() {
                document["workspace"]["labels"] = Item::Table(Table::new());
            }
            if document["workspace"]["labels"].get("members").is_none() {
                document["workspace"]["labels"]["members"] = Item::Table(Table::new());
            }
            let members = document["workspace"]["labels"]["members"]
                .as_table_like_mut()
                .expect("validated member table");
            if let Some(label) = label {
                if let Some(existing) = members.get_mut(member).and_then(Item::as_value_mut) {
                    let decor = existing.decor().clone();
                    *existing = toml_edit::Value::from(label);
                    *existing.decor_mut() = decor;
                } else {
                    members.insert(member, value(label));
                }
            } else {
                members.remove(member);
            }
        })
    }

    /// Apply one user-confirmed definition edit without rewriting other settings.
    pub fn save_label_edit(
        &mut self,
        expected: &WorkspaceLabels,
        edit: LabelEdit,
    ) -> Result<(), SquadError> {
        if self.workspace_labels()? != *expected {
            return Err(invalid("Labels changed; reload before saving."));
        }
        let index = match &edit {
            LabelEdit::Upsert(label) => {
                validate_label(label)?;
                let found = expected
                    .definitions
                    .iter()
                    .position(|old| old.id == label.id);
                if found.is_none() && expected.definitions.len() >= 32 {
                    return Err(invalid("A maximum of 32 labels is allowed."));
                }
                found
            }
            LabelEdit::Move { id, index } => {
                if *index >= expected.definitions.len() {
                    return Err(invalid("Label order is out of range."));
                }
                Some(
                    expected
                        .definitions
                        .iter()
                        .position(|old| &old.id == id)
                        .ok_or_else(|| invalid("Label no longer exists."))?,
                )
            }
            LabelEdit::Delete { id } => Some(
                expected
                    .definitions
                    .iter()
                    .position(|old| &old.id == id)
                    .ok_or_else(|| invalid("Label no longer exists."))?,
            ),
        };
        if matches!((&edit, index), (LabelEdit::Upsert(label), Some(index)) if expected.definitions[index] == *label)
            || matches!((&edit, index), (LabelEdit::Move { index: target, .. }, Some(index)) if *target == index)
        {
            return Ok(());
        }
        self.write(|document| {
            if document.get("workspace").is_none() {
                document["workspace"] = Item::Table(Table::new());
            }
            if document["workspace"].get("labels").is_none() {
                document["workspace"]["labels"] = Item::Table(Table::new());
            }
            let labels = document["workspace"]["labels"]
                .as_table_like_mut()
                .expect("validated label table");
            if labels.get("definitions").is_none() {
                let mut values = toml_edit::Array::new();
                for definition in &expected.definitions {
                    values.push(label_toml(definition));
                }
                labels.insert("definitions", value(values));
            }
            let values = labels
                .get_mut("definitions")
                .and_then(Item::as_value_mut)
                .and_then(toml_edit::Value::as_array_mut)
                .expect("validated definitions");
            match &edit {
                LabelEdit::Upsert(label) => {
                    if let Some(index) = index {
                        let table = values
                            .get_mut(index)
                            .and_then(toml_edit::Value::as_inline_table_mut)
                            .expect("validated definition");
                        for (key, next) in [
                            ("glyph", &label.glyph),
                            ("color", &label.color),
                            ("name", &label.name),
                        ] {
                            let old = table.get_mut(key).expect("validated field");
                            if old.as_str() != Some(next.as_str()) {
                                let decor = old.decor().clone();
                                *old = toml_edit::Value::from(next.as_str());
                                *old.decor_mut() = decor;
                            }
                        }
                    } else {
                        values.push(label_toml(label));
                    }
                }
                LabelEdit::Move { index: target, .. } => {
                    let item = values.remove(index.unwrap());
                    values.insert(*target, item);
                }
                LabelEdit::Delete { .. } => {
                    values.remove(index.unwrap());
                }
            }
            if let LabelEdit::Delete { id } = &edit
                && let Some(members) = labels.get_mut("members").and_then(Item::as_table_like_mut)
            {
                for (member, _) in expected.members.iter().filter(|(_, label)| *label == id) {
                    members.remove(member);
                }
            }
        })
    }

    /// Retired board composition remains in the authored file and in independent
    /// CLI projections. The shell reports exactly which settings need migration.
    pub fn workspace_migration_notices(&self) -> Vec<String> {
        let mut notices = Vec::new();
        fn board_notices(item: Option<&Item>, path: &str, notices: &mut Vec<String>) {
            if let Some(table) = item.and_then(Item::as_table_like) {
                for (key, _) in table.iter() {
                    if [
                        "mode",
                        "direction",
                        "panes",
                        "sizes",
                        "layout",
                        "collapsed",
                        "fold_below",
                        "view",
                        "hidden_columns",
                    ]
                    .contains(&key)
                    {
                        notices.push(format!("`{path}.{key}` belongs to the retired factory/pane layout; choose `workspace.layout = auto|side|stack` explicitly. The authored value is preserved for migration."));
                    }
                    if key == "ask_lead" {
                        notices.push(format!("`{path}.ask_lead` is retired; Talk uses the explicitly selected named agent, without this policy."));
                    }
                    if key == "home_replies" {
                        notices.push(format!("`{path}.home_replies` is retired; open the selected agent's conversation explicitly."));
                    }
                }
            }
        }
        board_notices(self.document.get("board"), "board", &mut notices);
        if let Some(squads) = self.document.get("squad").and_then(Item::as_table_like) {
            for (name, item) in squads.iter() {
                let Some(table) = item.as_table_like() else {
                    continue;
                };
                board_notices(
                    table.get("board"),
                    &format!("squad.{name}.board"),
                    &mut notices,
                );
                for key in ["layout", "rows", "columns", "sections"] {
                    if table.get(key).is_some() {
                        notices.push(format!("`squad.{name}.{key}` remains available to CLI listing; custom board sections/columns no longer compose the workspace. Use its squad tree and selected-agent details."));
                    }
                }
                if table
                    .get("notes")
                    .and_then(Item::as_table_like)
                    .is_some_and(|notes| notes.get("render").is_some())
                {
                    notices.push(format!("`squad.{name}.notes.render` belongs to the retired notebook pane. The authored value is preserved for migration; the workspace reads agent responses instead."));
                }
            }
        }
        if let Some(tabs) = self.document.get("tabs").and_then(Item::as_table_like) {
            for (key, _) in tabs.iter() {
                notices.push(format!("`tabs.{key}` remains available to CLI listing; old squad-tab arrangement does not control the three-tab workspace. Use UUID squad pins/sort and guarded 1/2/3."));
            }
        }
        if let Some(links) = self.document.get("links").and_then(Item::as_table_like) {
            for (scheme, _) in links.iter() {
                notices.push(format!("`links.{scheme}` belongs to retired notebook-link activation. The authored handler is preserved; configure an explicit workspace binding or opener for the selected agent's link."));
            }
        }
        if let Some(workspace) = self.document.get("workspace").and_then(Item::as_table_like) {
            panel_notice::<OverviewPanel>(
                workspace.get("overview_panels"),
                "overview_panels",
                &mut notices,
            );
            panel_notice::<DigestPanel>(
                workspace.get("digest_panels"),
                "digest_panels",
                &mut notices,
            );
        }
        notices
    }

    pub fn workspace_preferences(&self) -> Result<OpsPreferences, SquadError> {
        let Some(item) = self.document.get("workspace") else {
            return Ok(OpsPreferences::default());
        };
        let table = item
            .as_table_like()
            .ok_or_else(|| invalid("`workspace` must be a table."))?;
        let mut result = OpsPreferences::default();
        for (key, item) in table.iter() {
            match key {
                "read_markers" => {
                    self.read_markers()?;
                }
                "overview_panels" => result.overview_panels = Some(PanelSetting::observe(item)),
                "digest_panels" => result.digest_panels = Some(PanelSetting::observe(item)),
                "labels" => result.labels = self.workspace_labels()?,
                // Retired pin preferences remain untouched in user-owned TOML.
                "pinned" | "agent_pins" => {}
                "hidden" => {
                    let hidden = item.as_array().ok_or_else(|| {
                        invalid("`workspace.hidden` must be an array of room UUIDs.")
                    })?;
                    if hidden.len() > 1024 {
                        return Err(invalid("`workspace.hidden` allows at most 1024 squads."));
                    }
                    for value in hidden {
                        let id = value
                            .as_str()
                            .filter(|id| canonical_room_id(id))
                            .ok_or_else(|| {
                                invalid("`workspace.hidden` requires canonical room UUIDs.")
                            })?;
                        if !result.hidden.insert(id.into()) {
                            return Err(invalid(
                                "`workspace.hidden` contains a repeated room UUID.",
                            ));
                        }
                    }
                }
                "sort" => {
                    result.sort = match item.as_str() {
                        Some("name") => OpsSort::Name,
                        Some("attention") => OpsSort::Attention,
                        Some("members") => OpsSort::Members,
                        _ => {
                            return Err(invalid(
                                "`workspace.sort` must be name, attention or members.",
                            ));
                        }
                    }
                }
                "overview_sort" | "overview_reverse" => {}
                "reverse" => {
                    result.reversed = item
                        .as_bool()
                        .ok_or_else(|| invalid("`workspace.reverse` must be true or false."))?
                }
                "tok_range" => {
                    result.tok_range =
                        item.as_str().and_then(TokRange::parse).ok_or_else(|| {
                            invalid("`workspace.tok_range` must be 1h, 3h, 6h, 1d or 7d.")
                        })?;
                }
                // The Digest window is view state now; an older file still loads.
                "digest_window" => {}
                "savings_unit" => {
                    result.savings_unit = item
                        .as_str()
                        .and_then(super::SavingsUnit::parse)
                        .ok_or_else(|| {
                            invalid("`workspace.savings_unit` must be tokens, percent or cost.")
                        })?;
                }
                "layout" => {
                    result.layout = match item.as_str() {
                        Some("auto") => OpsLayout::Auto,
                        Some("side") => OpsLayout::Side,
                        Some("stack") => OpsLayout::Stack,
                        _ => {
                            return Err(invalid("`workspace.layout` must be auto, side or stack."));
                        }
                    }
                }
                _ => {
                    return Err(invalid(format!(
                        "`workspace.{key}` is not a supported preference."
                    )));
                }
            }
        }
        Ok(result)
    }

    /// The same format-preserving stale-file guard as other explicit settings
    /// writes. Presentation never creates a second preference file.
    pub fn save_workspace_preferences(
        &mut self,
        expected: &OpsPreferences,
        next: &OpsPreferences,
    ) -> Result<(), SquadError> {
        if self.workspace_preferences()? != *expected {
            return Err(invalid(
                "Workspace preferences changed; reload before saving.",
            ));
        }
        if next.hidden.len() > 1024 || next.hidden.iter().any(|id| !canonical_room_id(id)) {
            return Err(invalid(
                "Hidden squads require canonical room UUIDs, at most 1024.",
            ));
        }
        validate_panel_save(&expected.overview_panels, &next.overview_panels)?;
        validate_panel_save(&expected.digest_panels, &next.digest_panels)?;
        self.write(|document| {
            if document.get("workspace").is_none() {
                document["workspace"] = Item::Table(Table::new());
            }
            write_panel(
                document,
                "overview_panels",
                &expected.overview_panels,
                &next.overview_panels,
            );
            write_panel(
                document,
                "digest_panels",
                &expected.digest_panels,
                &next.digest_panels,
            );
            if !next.hidden.is_empty() {
                let mut hidden = toml_edit::Array::new();
                for id in &next.hidden {
                    hidden.push(id.as_str());
                }
                document["workspace"]["hidden"] = value(hidden);
            } else if let Some(table) = document["workspace"].as_table_like_mut() {
                table.remove("hidden");
            }
            document["workspace"]["sort"] = value(match next.sort {
                OpsSort::Name => "name",
                OpsSort::Attention => "attention",
                OpsSort::Members => "members",
            });
            document["workspace"]["reverse"] = value(next.reversed);
            document["workspace"]["tok_range"] = value(next.tok_range.argument());
            document["workspace"]["savings_unit"] = value(next.savings_unit.argument());
            document["workspace"]["layout"] = value(match next.layout {
                OpsLayout::Auto => "auto",
                OpsLayout::Side => "side",
                OpsLayout::Stack => "stack",
            });
        })
    }

    /// Locations in precedence order for this exact selected occurrence.
    pub fn binding_locations(
        &self,
        row: Option<&Value>,
        recipient: Option<&Value>,
        squad: Option<&str>,
    ) -> Result<Vec<super::BindingLocation>, SquadError> {
        use super::BindingLocation;
        let mut locations = vec![BindingLocation::Global];
        if let Some(host) = recipient
            .and_then(|row| row["pane"]["location"]["host"].as_str())
            .filter(|host| super::valid_host(host))
        {
            locations.push(BindingLocation::Host(host.into()));
        }
        if let Some(squad) = squad.filter(|name| !name.is_empty())
            && let Some((index, _)) = self
                .sections(squad)?
                .iter()
                .enumerate()
                .find(|(_, section)| row.is_some_and(|row| section.includes(row)))
        {
            locations.push(BindingLocation::Section {
                squad: squad.into(),
                index,
            });
        }
        Ok(locations)
    }

    pub fn binding_at(
        &self,
        location: &super::BindingLocation,
        event: &str,
    ) -> Result<Option<Action>, SquadError> {
        use super::BindingLocation;
        Ok(match location {
            BindingLocation::Global => self.configured_bindings()?.get(event).cloned(),
            BindingLocation::Host(host) => self
                .host_bindings()?
                .get(host)
                .and_then(|keys| keys.get(event))
                .cloned(),
            BindingLocation::Section { squad, index } => self
                .sections(squad)?
                .get(*index)
                .and_then(|section| section.bind.get(event))
                .cloned(),
        })
    }

    pub fn binding_events(
        &self,
        locations: &[super::BindingLocation],
    ) -> Result<Vec<String>, SquadError> {
        use super::BindingLocation;
        let mut events: std::collections::BTreeSet<_> =
            crate::action::binding_events().into_iter().collect();
        for location in locations {
            let bindings = match location {
                BindingLocation::Global => self.configured_bindings()?,
                BindingLocation::Host(host) => {
                    self.host_bindings()?.remove(host).unwrap_or_default()
                }
                BindingLocation::Section { squad, index } => self
                    .sections(squad)?
                    .get(*index)
                    .map(|section| section.bind.clone())
                    .unwrap_or_default(),
            };
            events.extend(bindings.into_keys());
        }
        Ok(events.into_iter().collect())
    }

    pub fn binding(
        &self,
        scope: OpsKeyScope,
        locations: &[super::BindingLocation],
        event: &str,
        factory: &Bindings,
    ) -> Result<super::ResolvedBinding, SquadError> {
        let host = locations.iter().find_map(|location| match location {
            super::BindingLocation::Host(host) => Some(host.as_str()),
            _ => None,
        });
        let sections = locations
            .iter()
            .find_map(|location| match location {
                super::BindingLocation::Section { squad, index } => Some((squad, *index)),
                _ => None,
            })
            .map(|(squad, index)| {
                self.sections(squad)
                    .map(|sections| sections.get(index).cloned())
            })
            .transpose()?
            .flatten();
        let keys =
            self.workspace_keys(scope, host, sections.as_ref().map(|section| &section.bind))?;
        let mut owner = None;
        let mut authored = None;
        for location in locations {
            if let Some(action) = self.binding_at(location, event)? {
                owner = Some(location.clone());
                authored = Some(action);
            }
        }
        let effective = if owner.is_none()
            || keys
                .sources
                .get(event)
                .is_some_and(|source| source == "workspace default")
        {
            factory
                .get(event)
                .or_else(|| keys.bindings.get(event))
                .cloned()
        } else {
            keys.bindings.get(event).cloned()
        };
        Ok(super::ResolvedBinding {
            action: effective,
            owner,
            authored,
        })
    }

    pub fn workspace_keys(
        &self,
        scope: OpsKeyScope,
        host: Option<&str>,
        section: Option<&Bindings>,
    ) -> Result<WorkspaceKeys, SquadError> {
        let mut effective = defaults(scope);
        let mut sources: std::collections::BTreeMap<_, _> = effective
            .keys()
            .map(|key| (key.clone(), "workspace default".into()))
            .collect();
        let mut notices = self.workspace_migration_notices();
        let mut configured = self.configured_bindings()?;
        let hosts = self.host_bindings()?;
        if let Some(host) = host.and_then(|host| hosts.get(host)) {
            configured.extend(host.clone());
        }
        if let Some(section) = section {
            configured.extend(section.clone());
        }
        for (key, action) in configured {
            if action.verb == Verb::Unbound {
                // `[bind]` is one table for every scope: the key loses its default here, and a key
                // that no scope binds by default has nothing to lose.
                let removed = effective.remove(&key).is_some();
                sources.remove(&key);
                if !removed
                    && !OpsKeyScope::ALL
                        .iter()
                        .any(|scope| defaults(*scope).contains_key(&key))
                {
                    notices.push(format!(
                        "`bind.{key}` = unbound: `{key}` has no default binding to remove."
                    ));
                }
                continue;
            }
            if let Err(error) = admit_action(&action, &format!("bind.{key}")) {
                notices.push(error.message);
                if matches!(action.verb, Verb::Retired(_)) {
                    effective.remove(&key);
                    sources.remove(&key);
                }
                continue;
            }
            if action.verb == Verb::Ui(OpsUiAction::MemberBack) && !is_chord(&key) {
                notices.push(format!(
                    "`bind.{key}` = member-back also keeps `{key}` from reaching the agent in its full-screen terminal; a ctrl- or alt- chord avoids that."
                ));
            }
            let source = configured_binding_source(&key, host, &hosts, section);
            sources.insert(key.clone(), source);
            effective.insert(key, action);
        }
        Ok(WorkspaceKeys {
            bindings: effective,
            sources,
            notices,
        })
    }
}

/// A key with Ctrl, Alt or Super held, which a program in a terminal rarely needs for itself.
fn is_chord(key: &str) -> bool {
    key.starts_with("ctrl-") || key.starts_with("alt-") || key.starts_with("super-")
}

fn configured_binding_source(
    key: &str,
    host: Option<&str>,
    hosts: &std::collections::BTreeMap<String, Bindings>,
    section: Option<&Bindings>,
) -> String {
    if section.is_some_and(|section| section.contains_key(key)) {
        "selected squad section.bind".into()
    } else if let Some(host) =
        host.filter(|host| hosts.get(*host).is_some_and(|keys| keys.contains_key(key)))
    {
        format!("bind.{host}.{key}")
    } else {
        format!("bind.{key}")
    }
}

fn panel_notice<P: Panel>(item: Option<&Item>, key: &str, notices: &mut Vec<String>) {
    if let Some(table) = item.and_then(Item::as_table_like) {
        for field in ["order", "hidden"] {
            if let Some(values) = table.get(field).and_then(Item::as_array) {
                for value in values {
                    if let Some(id) = value.as_str().filter(|id| P::RETIRED.contains(id)) {
                        notices.push(format!("`workspace.{key}.{field}`: '{id}' is retired; Digest has a fixed summary, TOK table and Exchanges. The authored value is preserved for migration."));
                    }
                }
            }
        }
        if key == "digest_panels" && table.get("order").is_some() {
            notices.push("`workspace.digest_panels.order` is retired; Digest sections have fixed positions. The authored value is preserved for migration.".into());
        }
    }
    if let Some(error) = item
        .map(PanelSetting::<P>::observe)
        .and_then(|setting| setting.error().map(str::to_owned))
    {
        notices.push(format!(
            "`workspace.{key}`: {error}; using dashboard defaults. The authored value is unchanged."
        ));
    }
}
fn validate_panel_save<P: Panel>(
    expected: &Option<PanelSetting<P>>,
    next: &Option<PanelSetting<P>>,
) -> Result<(), SquadError> {
    if expected != next && next.as_ref().is_some_and(|setting| !setting.writable()) {
        return Err(invalid(
            "An explicit panel Save must contain a complete valid policy.",
        ));
    }
    Ok(())
}
fn write_panel<P: Panel>(
    document: &mut DocumentMut,
    key: &str,
    expected: &Option<PanelSetting<P>>,
    next: &Option<PanelSetting<P>>,
) {
    if expected == next {
        return;
    }
    let workspace = document["workspace"]
        .as_table_like_mut()
        .expect("workspace validated");
    match next {
        None => {
            workspace.remove(key);
        }
        Some(setting) => {
            if let Some(item) = workspace.get_mut(key) {
                setting.write(item);
            } else {
                let mut item = Item::Table(Table::new());
                setting.write(&mut item);
                workspace.insert(key, item);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn action_provenance_tracks_only_the_admitted_effective_merge() {
        let config =
            config("[bind]\no = \"open {pr_link}\"\n[bind.tmux]\no = \"open {review_link}\"\n");
        let section = [("o".into(), Action::parse("open {link}").unwrap())].into();
        let global = config
            .workspace_keys(OpsKeyScope::Member, None, None)
            .unwrap();
        assert_eq!(global.sources["o"], "bind.o");
        let host = config
            .workspace_keys(OpsKeyScope::Member, Some("tmux"), None)
            .unwrap();
        assert_eq!(host.sources["o"], "bind.tmux.o");
        let selected = config
            .workspace_keys(OpsKeyScope::Member, Some("tmux"), Some(&section))
            .unwrap();
        assert_eq!(selected.sources["o"], "selected squad section.bind");
        assert_eq!(selected.bindings["o"].text, "open {link}");
        assert_eq!(selected.sources["j"], "workspace default");
    }
    fn config(text: &str) -> Config {
        Config {
            path: "/fixture/ops.toml".into(),
            original: None,
            document: text.parse().unwrap(),
            global_theme: Vec::new(),
            theme_error: None,
        }
    }
    #[test]
    fn real_defaults_and_overrides_share_one_effective_table() {
        let config = config("[bind]\nj='copy'\ns='talk'\n[bind.tmux]\nj='open'\n");
        let section: Bindings = [("j".into(), Action::parse("run /usr/bin/true").unwrap())].into();
        let defaults = config
            .workspace_keys(OpsKeyScope::Member, None, None)
            .unwrap()
            .bindings;
        assert_eq!(defaults["j"].verb, Verb::Copy);
        assert_eq!(defaults["s"].verb, Verb::Talk);
        let hosted = config
            .workspace_keys(OpsKeyScope::Member, Some("tmux"), None)
            .unwrap()
            .bindings;
        assert_eq!(hosted["j"].verb, Verb::Open);
        let scoped = config
            .workspace_keys(OpsKeyScope::Member, Some("tmux"), Some(&section))
            .unwrap()
            .bindings;
        assert_eq!(scoped["j"].verb, Verb::Run);
        assert!(
            !scoped.contains_key("S"),
            "runtime changes belong in Edit by default"
        );
        assert_eq!(scoped["e"].text, "edit");
        for (event, action) in scoped {
            assert!(!event.is_empty());
            assert!(!action.description().is_empty());
        }
    }
    #[test]
    fn agents_filter_default_yields_to_global_host_and_section_bindings() {
        let config = config("[bind]\nf='search'\n[bind.tmux]\nf='talk'\n");
        let section: Bindings = [("f".into(), Action::parse("run /usr/bin/true").unwrap())].into();
        for scope in [OpsKeyScope::Squad, OpsKeyScope::Member, OpsKeyScope::Pool] {
            assert!(!defaults(scope).contains_key("f"));
            for (host, section, expected, source) in [
                (None, None, "search", "bind.f"),
                (Some("tmux"), None, "talk", "bind.tmux.f"),
                (
                    Some("tmux"),
                    Some(&section),
                    "run /usr/bin/true",
                    "selected squad section.bind",
                ),
            ] {
                let keys = config.workspace_keys(scope, host, section).unwrap();
                assert_eq!(keys.bindings["f"].text, expected);
                assert_eq!(keys.sources["f"], source);
            }
        }
    }
    #[test]
    fn agents_filter_default_yields_to_all_explicit_binding_scopes() {
        let config = config("[bind]\nv='search'\n[bind.tmux]\nv='talk'\n");
        for scope in [
            OpsKeyScope::Reader,
            OpsKeyScope::Member,
            OpsKeyScope::Squad,
            OpsKeyScope::Pool,
        ] {
            assert!(!defaults(scope).contains_key("f"));
        }
        for scope in [
            OpsKeyScope::Reader,
            OpsKeyScope::Member,
            OpsKeyScope::Squad,
            OpsKeyScope::Pool,
        ] {
            assert_eq!(
                config.workspace_keys(scope, None, None).unwrap().bindings["v"].text,
                "search"
            );
            assert_eq!(
                config
                    .workspace_keys(scope, Some("tmux"), None)
                    .unwrap()
                    .bindings["v"]
                    .text,
                "talk"
            );
            let section: Bindings =
                [("v".into(), Action::parse("run /usr/bin/true").unwrap())].into();
            assert_eq!(
                config
                    .workspace_keys(scope, Some("tmux"), Some(&section))
                    .unwrap()
                    .bindings["v"]
                    .verb,
                Verb::Run
            );
        }
    }

    #[test]
    fn agents_shortcuts_authored_actions_keep_global_host_and_section_precedence() {
        for event in ["r", "d", "a", "v"] {
            let cfg = config(&format!(
                "[bind]\n{event}='copy global'\n[bind.tmux]\n{event}='copy host'\n"
            ));
            let section: Bindings = [(event.into(), Action::parse("copy section").unwrap())].into();
            for scope in [
                OpsKeyScope::Squad,
                OpsKeyScope::Member,
                OpsKeyScope::Pool,
                OpsKeyScope::Reader,
            ] {
                assert_eq!(
                    cfg.workspace_keys(scope, None, None).unwrap().bindings[event].text,
                    "copy global"
                );
                assert_eq!(
                    cfg.workspace_keys(scope, Some("tmux"), None)
                        .unwrap()
                        .bindings[event]
                        .text,
                    "copy host"
                );
                assert_eq!(
                    cfg.workspace_keys(scope, Some("tmux"), Some(&section))
                        .unwrap()
                        .bindings[event]
                        .text,
                    "copy section"
                );
            }
        }
    }
    #[test]
    fn agents_shortcuts_leave_duplicate_actions_unbound_by_default() {
        for scope in [
            OpsKeyScope::Squad,
            OpsKeyScope::Member,
            OpsKeyScope::Pool,
            OpsKeyScope::Reader,
        ] {
            let factory = config("").workspace_keys(scope, None, None).unwrap();
            for key in ["d", "a", "v"] {
                assert!(!factory.bindings.contains_key(key), "{scope:?}: {key}");
            }
            if matches!(scope, OpsKeyScope::Member | OpsKeyScope::Squad) {
                assert_eq!(factory.bindings["r"].text, "rename");
            } else {
                assert!(!factory.bindings.contains_key("r"));
            }
        }
    }

    #[test]
    fn factory_measure_key_is_unique_outside_readers_and_t_opens_only_a_member_terminal() {
        for scope in [
            OpsKeyScope::Squad,
            OpsKeyScope::Member,
            OpsKeyScope::Pool,
            OpsKeyScope::Reader,
        ] {
            let factory = config("").workspace_keys(scope, None, None).unwrap();
            // `t` opens an extra terminal under a member (#5991), and only there; `j` fills the
            // board with a built-in member's terminal (#5989).
            assert_eq!(
                factory.bindings.get("t").map(|action| action.text.as_str()),
                (scope == OpsKeyScope::Member).then_some("terminal-new"),
                "{scope:?}"
            );
            assert_eq!(factory.bindings["T"].text, "pane-talk", "{scope:?}");
            assert_eq!(factory.bindings["M"].text, "pane-measure", "{scope:?}");
        }
    }

    #[test]
    fn authored_t_keeps_global_host_and_section_precedence() {
        for scope in [
            OpsKeyScope::Squad,
            OpsKeyScope::Member,
            OpsKeyScope::Pool,
            OpsKeyScope::Reader,
        ] {
            let configured = config("[bind]\nt='talk'\n[bind.tmux]\nt='copy'\n");
            assert_eq!(
                configured
                    .workspace_keys(scope, None, None)
                    .unwrap()
                    .bindings["t"]
                    .verb,
                Verb::Talk
            );
            assert_eq!(
                configured
                    .workspace_keys(scope, Some("tmux"), None)
                    .unwrap()
                    .bindings["t"]
                    .verb,
                Verb::Copy
            );
            let section = [("t".into(), Action::parse("open").unwrap())].into();
            assert_eq!(
                configured
                    .workspace_keys(scope, Some("tmux"), Some(&section))
                    .unwrap()
                    .bindings["t"]
                    .verb,
                Verb::Open
            );
        }
    }

    #[test]
    fn reader_defaults_and_explicit_overrides_use_the_same_precedence() {
        let plain = config("")
            .workspace_keys(OpsKeyScope::Reader, None, None)
            .unwrap();
        for (event, name) in [
            ("j", "scroll-down"),
            ("k", "scroll-up"),
            ("pageup", "scroll-page-up"),
            ("end", "scroll-bottom"),
            ("enter", "talk"),
        ] {
            assert_eq!(plain.bindings[event].text, name);
        }
        assert!(!plain.bindings.contains_key("p"));
        for key in ["left", "right", "s", "t", "x"] {
            assert!(!plain.bindings.contains_key(key), "{key}");
        }
        let config = config("[bind]\nj='copy'\n[bind.tmux]\nj='open'\n");
        let section: Bindings = [("j".into(), Action::parse("run /usr/bin/true").unwrap())].into();
        assert_eq!(
            config
                .workspace_keys(OpsKeyScope::Reader, None, None)
                .unwrap()
                .bindings["j"]
                .verb,
            Verb::Copy
        );
        assert_eq!(
            config
                .workspace_keys(OpsKeyScope::Reader, Some("tmux"), None)
                .unwrap()
                .bindings["j"]
                .verb,
            Verb::Open
        );
        assert_eq!(
            config
                .workspace_keys(OpsKeyScope::Reader, Some("tmux"), Some(&section))
                .unwrap()
                .bindings["j"]
                .verb,
            Verb::Run
        );
    }
    #[test]
    fn reader_digit_overrides_are_active_and_leave_the_authored_config_unchanged() {
        let config = config("[bind]\n1='copy $name'\n2='agents'\n3='digest-dashboard'\n");
        let original = config.document.to_string();
        let reader = config
            .workspace_keys(OpsKeyScope::Reader, None, None)
            .unwrap();
        let list = config
            .workspace_keys(OpsKeyScope::Member, None, None)
            .unwrap();
        for key in ["1", "2", "3"] {
            assert_eq!(reader.bindings[key], list.bindings[key]);
        }
        assert!(reader.notices.is_empty());
        assert_eq!(config.document.to_string(), original);
    }
    #[test]
    fn source_reader_and_destination_defaults_are_unique_and_yield_to_authored_keys() {
        for scope in [OpsKeyScope::Member, OpsKeyScope::Reader] {
            let defaults = defaults(scope);
            for (event, verb) in [("1", "agents"), ("2", "digest-dashboard")] {
                assert_eq!(defaults[event].text, verb);
                assert_eq!(
                    defaults
                        .values()
                        .filter(|action| action.text == verb)
                        .count(),
                    1
                );
            }
            let config = config("[bind]\nv='copy'\n[bind.tmux]\nv='open'\n");
            let section = [("v".into(), Action::parse("talk").unwrap())].into();
            assert_eq!(
                config.workspace_keys(scope, None, None).unwrap().bindings["v"].verb,
                Verb::Copy
            );
            assert_eq!(
                config
                    .workspace_keys(scope, Some("tmux"), None)
                    .unwrap()
                    .bindings["v"]
                    .verb,
                Verb::Open
            );
            assert_eq!(
                config
                    .workspace_keys(scope, Some("tmux"), Some(&section))
                    .unwrap()
                    .bindings["v"]
                    .verb,
                Verb::Talk
            );
        }
    }

    #[test]
    fn backtab_defaults_share_tab_action_per_scope_and_authored_bindings_win() {
        for scope in [
            OpsKeyScope::Squad,
            OpsKeyScope::Member,
            OpsKeyScope::Pool,
            OpsKeyScope::Reader,
        ] {
            let base = config("").workspace_keys(scope, None, None).unwrap();
            assert_eq!(base.bindings["tab"].verb, Verb::NextPane);
            assert_eq!(base.bindings["backtab"].verb, Verb::NextPane);
            let configured = config("[bind]\nbacktab='help'\n")
                .workspace_keys(scope, None, None)
                .unwrap();
            assert_eq!(configured.bindings["tab"].verb, Verb::NextPane);
            assert_eq!(configured.bindings["backtab"].text, "help");
            assert_eq!(configured.sources["backtab"], "bind.backtab");
        }
    }
    #[test]
    fn unbound_removes_the_default_of_its_key_in_every_scope_and_layer() {
        for scope in OpsKeyScope::ALL {
            let factory = config("").workspace_keys(scope, None, None).unwrap();
            let keys = config("[bind]\nC='unbound'\n")
                .workspace_keys(scope, None, None)
                .unwrap();
            assert!(!keys.bindings.contains_key("C"), "{scope:?}");
            assert!(!keys.sources.contains_key("C"), "{scope:?}");
            assert!(keys.notices.is_empty(), "{scope:?}: {:?}", keys.notices);
            // Nothing else moves.
            let mut expected = factory.bindings.clone();
            expected.remove("C");
            assert_eq!(keys.bindings, expected, "{scope:?}");
        }
        // A host table may remove it for that host only, and a later layer may bind it again.
        let host = config("[bind.tmux]\nC='unbound'\n");
        assert!(
            !host
                .workspace_keys(OpsKeyScope::Member, Some("tmux"), None)
                .unwrap()
                .bindings
                .contains_key("C")
        );
        assert!(
            host.workspace_keys(OpsKeyScope::Member, None, None)
                .unwrap()
                .bindings
                .contains_key("C")
        );
        let rebound = config("[bind]\nC='unbound'\n[bind.tmux]\nC='copy'\n");
        assert_eq!(
            rebound
                .workspace_keys(OpsKeyScope::Member, Some("tmux"), None)
                .unwrap()
                .bindings["C"]
                .verb,
            Verb::Copy
        );
    }

    #[test]
    fn unbound_on_a_key_nothing_binds_by_default_is_a_notice_not_an_error() {
        for scope in OpsKeyScope::ALL {
            let keys = config("[bind]\nctrl-y='unbound'\n")
                .workspace_keys(scope, None, None)
                .unwrap();
            assert!(!keys.bindings.contains_key("ctrl-y"), "{scope:?}");
            assert!(
                keys.notices
                    .iter()
                    .any(|notice| notice.contains("`bind.ctrl-y`")
                        && notice.contains("no default binding to remove")),
                "{scope:?}: {:?}",
                keys.notices
            );
        }
        // A key that is a default in some other scope is not a no-op, so it is not noticed.
        let keys = config("[bind]\nx='unbound'\n")
            .workspace_keys(OpsKeyScope::Squad, None, None)
            .unwrap();
        assert!(
            defaults(OpsKeyScope::Member).contains_key("x")
                && !defaults(OpsKeyScope::Squad).contains_key("x")
        );
        assert!(keys.notices.is_empty(), "{:?}", keys.notices);
    }

    #[test]
    fn a_misspelt_unbound_keeps_the_unknown_action_error() {
        let error = config("[bind]\nC='unbund'\n")
            .workspace_keys(OpsKeyScope::Member, None, None)
            .err()
            .expect("an unknown action is refused");
        assert!(
            error.message.contains("'unbund' is not an action"),
            "{}",
            error.message
        );
    }

    #[test]
    fn unbound_takes_no_arguments_and_reads_back_as_written() {
        assert!(Action::parse("unbound now").is_err());
        let action = Action::parse("unbound").unwrap();
        assert_eq!(action.verb, Verb::Unbound);
        assert_eq!(action.text, "unbound");
        let document = config("[bind]\nC='unbound'\n");
        assert_eq!(
            document.configured_bindings().unwrap()["C"].verb,
            Verb::Unbound,
            "the authored word is kept in the table"
        );
    }

    #[test]
    fn member_back_is_ctrl_g_everywhere_and_a_bare_key_warns() {
        for scope in [
            OpsKeyScope::Squad,
            OpsKeyScope::Member,
            OpsKeyScope::Pool,
            OpsKeyScope::Reader,
        ] {
            let factory = config("").workspace_keys(scope, None, None).unwrap();
            assert_eq!(factory.bindings["ctrl-g"].text, "member-back", "{scope:?}");
            assert!(!factory.bindings.contains_key("z"), "{scope:?}");
        }
        for (key, warns) in [("x", true), ("ctrl-x", false), ("alt-x", false)] {
            let keys = config(&format!("[bind]\n{key}='member-back'\n"))
                .workspace_keys(OpsKeyScope::Member, None, None)
                .unwrap();
            assert_eq!(keys.bindings[key].verb, Verb::Ui(OpsUiAction::MemberBack));
            assert_eq!(
                keys.notices
                    .iter()
                    .any(|notice| notice.contains(&format!("`bind.{key}`"))
                        && notice.contains("reaching the agent")),
                warns,
                "{key}: {:?}",
                keys.notices
            );
        }
    }

    #[test]
    fn checklist_action_uses_its_current_name_without_a_legacy_alias() {
        let keys = config("[bind]\nN='member-checklist'\n")
            .workspace_keys(OpsKeyScope::Member, None, None)
            .unwrap();
        assert_eq!(keys.bindings["N"].verb, Verb::Ui(OpsUiAction::MemberNotes));
        assert_eq!(keys.sources["N"], "bind.N");
        assert!(keys.notices.is_empty());
        let error = config("[bind]\nN='member-notes'\n")
            .workspace_keys(OpsKeyScope::Member, None, None)
            .err()
            .expect("the former action is unknown, not an alias");
        assert_eq!(error.message, "`bind.N`: 'member-notes' is not an action");
    }

    #[test]
    fn every_approved_scope_has_its_real_keys_without_legacy_fallbacks() {
        let config = config("");
        let squad = config
            .workspace_keys(OpsKeyScope::Squad, None, None)
            .unwrap()
            .bindings;
        assert_eq!(squad["N"].text, "create-squad");
        assert!(!squad.contains_key("p"));
        for scope in [OpsKeyScope::Member, OpsKeyScope::Reader] {
            let keys = config.workspace_keys(scope, None, None).unwrap().bindings;
            assert_eq!(keys["C"].text, "member-checklist", "{scope:?}");
            assert!(!keys.contains_key("N"), "{scope:?}");
        }
        let pool = config
            .workspace_keys(OpsKeyScope::Pool, None, None)
            .unwrap()
            .bindings;
        assert_eq!(pool["N"].text, "create-squad");
        let member = config
            .workspace_keys(OpsKeyScope::Member, None, None)
            .unwrap()
            .bindings;
        assert_eq!(member["r"].text, "rename");
        assert_eq!(member["D"].text, "digest");
        assert_eq!(member["x"].text, "remove-member");
        assert_eq!(squad["w"].text, "workspace-snapshots");
        assert!(!member.contains_key("A"));
        assert_eq!(squad["left"].text, "fold");
        assert_eq!(squad["right"].text, "expand");
    }
    #[test]
    fn snapshot_default_yields_to_explicit_global_host_and_section_bindings() {
        let config = config("[bind]\nw='talk'\n[bind.tmux]\nw='open'\n");
        let section: Bindings = [("w".into(), Action::parse("copy").unwrap())].into();
        for scope in [OpsKeyScope::Squad, OpsKeyScope::Member, OpsKeyScope::Pool] {
            assert_eq!(defaults(scope)["w"].text, "workspace-snapshots");
            let global = config.workspace_keys(scope, None, None).unwrap();
            assert_eq!(global.bindings["w"].verb, Verb::Talk);
            assert!(global.notices.is_empty());
            assert_eq!(
                config
                    .workspace_keys(scope, Some("tmux"), None)
                    .unwrap()
                    .bindings["w"]
                    .verb,
                Verb::Open
            );
            assert_eq!(
                config
                    .workspace_keys(scope, Some("tmux"), Some(&section))
                    .unwrap()
                    .bindings["w"]
                    .verb,
                Verb::Copy
            );
        }
        assert_eq!(
            defaults(OpsKeyScope::Reader)["w"].text,
            "workspace-snapshots"
        );
    }
    #[test]
    fn rename_default_accepts_explicit_global_host_and_section_bindings() {
        let config = config("[bind]\nr='talk'\n[bind.tmux]\nr='open'\n");
        let section: Bindings = [("r".into(), Action::parse("copy").unwrap())].into();
        assert_eq!(defaults(OpsKeyScope::Member)["r"].text, "rename");
        assert_eq!(
            config
                .workspace_keys(OpsKeyScope::Member, None, None)
                .unwrap()
                .bindings["r"]
                .verb,
            Verb::Talk
        );
        assert_eq!(
            config
                .workspace_keys(OpsKeyScope::Member, Some("tmux"), None)
                .unwrap()
                .bindings["r"]
                .verb,
            Verb::Open
        );
        assert_eq!(
            config
                .workspace_keys(OpsKeyScope::Member, Some("tmux"), Some(&section))
                .unwrap()
                .bindings["r"]
                .verb,
            Verb::Copy
        );
        for scope in [OpsKeyScope::Pool, OpsKeyScope::Reader] {
            assert!(!defaults(scope).contains_key("r"));
        }
    }
    #[test]
    fn retired_bindings_are_reported_without_rewriting_config() {
        for binding in [
            "A='ask-lead'",
            "s='home-pick'",
            "L='jump lead'",
            "V='view'",
            "N='notes'",
            "f='overview-filter'",
        ] {
            let config = config(&format!("[bind]\n{binding}"));
            let before = config.document.to_string();
            assert!(
                config
                    .workspace_keys(OpsKeyScope::Member, None, None)
                    .unwrap()
                    .notices
                    .len()
                    == 1
            );
            assert_eq!(config.document.to_string(), before);
        }
    }
    #[test]
    fn retired_overview_filter_reports_migration_without_retargeting_the_key() {
        for text in [
            "[bind]\nf = 'overview-filter'",
            "[bind.tmux]\nf = 'overview-filter'",
        ] {
            let config = config(text);
            let before = config.document.to_string();
            let keys = config
                .workspace_keys(OpsKeyScope::Member, Some("tmux"), None)
                .unwrap();
            assert!(
                keys.notices
                    .iter()
                    .any(|notice| notice.contains("overview-filter")
                        && notice.contains("squad tree"))
            );
            assert!(!keys.bindings.contains_key("f"));
            assert_eq!(config.document.to_string(), before);
            assert!(
                !keys
                    .bindings
                    .values()
                    .any(|action| action.text == "overview-view")
            );
        }
    }
    #[test]
    fn retired_factory_and_tab_settings_have_located_notices_without_rewriting_user_text() {
        let config = config(
            "[board]\nview='team'\nhome_replies=true\n[tabs]\norder=['product']\n[squad.product.board]\ndirection='left-right'\ntoken_rate={enabled=false}\n[squad.product]\nlayout='crew'\n",
        );
        let before = config.document.to_string();
        let notices = config.workspace_migration_notices();
        for path in [
            "board.view",
            "board.home_replies",
            "tabs.order",
            "squad.product.board.direction",
            "squad.product.layout",
        ] {
            assert!(
                notices.iter().any(|notice| notice.contains(path)),
                "missing {path}"
            );
        }
        assert!(!notices.iter().any(|notice| notice.contains("token_rate")));
        assert_eq!(
            config.layout("product").unwrap(),
            super::super::Layout::Crew
        );
        assert_eq!(config.document.to_string(), before);
    }
    #[test]
    fn retired_notebook_settings_and_handlers_remain_authored_with_located_notices() {
        let config =
            config("[squad.product.notes]\nrender='plain'\n[links]\nissue='run echo {path}'\n");
        let before = config.document.to_string();
        let notices = config.workspace_migration_notices();
        for path in ["squad.product.notes.render", "links.issue"] {
            assert!(notices.iter().any(|notice| notice.contains(path)), "{path}");
        }
        assert_eq!(
            config.notes_render("product").unwrap(),
            crate::config::NotesRender::Plain
        );
        assert!(config.links().unwrap().contains_key("issue"));
        assert_eq!(config.document.to_string(), before);
    }

    struct FileFixture(PathBuf);
    impl FileFixture {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "ops-workspace-config-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            fs::write(
                root.join("ops.toml"),
                "# preserve user text\n[bind]\nj='copy'\n[squad.other]\nlayout='crew'\n",
            )
            .unwrap();
            Self(root)
        }
        fn config(&self) -> Config {
            Config::read(self.0.join("ops.toml")).unwrap()
        }
    }
    impl Drop for FileFixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn workspace_labels_are_admitted_without_touching_legacy_settings() {
        let fixture = FileFixture::new();
        let authored = "# keep this comment\n[workspace]\npinned = ['legacy'] # untouched\nagent_pins = 'legacy'\noverview_sort = 'legacy'\n[workspace.labels]\ndefinitions = [{id = 'review', glyph = 'R', color = 'accent', name = 'review'}]\n[workspace.labels.members]\n\"66666666-6666-4666-8666-666666666666\" = 'review'\n";
        fs::write(fixture.0.join("ops.toml"), authored).unwrap();
        fixture
            .config()
            .workspace_preferences()
            .expect("workspace label settings are valid");
        assert_eq!(
            fs::read_to_string(fixture.0.join("ops.toml")).unwrap(),
            authored
        );
    }

    #[test]
    fn assigning_a_member_label_changes_only_that_value_and_guards_stale_files() {
        let fixture = FileFixture::new();
        let authored = "# keep this comment\n[workspace]\npinned = ['legacy'] # untouched\nagent_pins = 'legacy'\noverview_sort = 'legacy'\n[workspace.labels]\ndefinitions = [{id = 'pr', glyph = 'P', color = 'waiting', name = 'PR'}, {id = 'review', glyph = 'R', color = 'accent', name = 'review'}]\n[workspace.labels.members]\n\"66666666-6666-4666-8666-666666666666\" = 'review' # member\n";
        fs::write(fixture.0.join("ops.toml"), authored).unwrap();
        let mut first = fixture.config();
        let mut stale = fixture.config();
        let expected = first.workspace_labels().unwrap();
        first
            .save_member_label(
                &expected,
                "66666666-6666-4666-8666-666666666666",
                Some("pr"),
            )
            .unwrap();
        let updated = fs::read_to_string(first.path()).unwrap();
        assert_eq!(
            updated,
            authored.replace("= 'review' # member", "= \"pr\" # member")
        );
        assert!(
            stale
                .save_member_label(&expected, "66666666-6666-4666-8666-666666666666", None)
                .is_err()
        );
        assert_eq!(fs::read_to_string(first.path()).unwrap(), updated);
        let current = first.workspace_labels().unwrap();
        let externally_edited = format!("{updated}# external edit\n");
        fs::write(first.path(), &externally_edited).unwrap();
        first
            .save_member_label(&current, "66666666-6666-4666-8666-666666666666", Some("pr"))
            .unwrap();
        assert_eq!(fs::read_to_string(first.path()).unwrap(), externally_edited);
    }

    #[test]
    fn label_defaults_explicit_empty_and_glyph_admission_are_distinct() {
        let fixture = FileFixture::new();
        assert_eq!(
            fixture
                .config()
                .workspace_labels()
                .unwrap()
                .definitions
                .len(),
            5
        );
        let mut config = fixture.config();
        let original = fs::read(config.path()).unwrap();
        let labels = config.workspace_labels().unwrap();
        config
            .save_member_label(&labels, "66666666-6666-4666-8666-666666666666", None)
            .unwrap();
        assert_eq!(
            fs::read(config.path()).unwrap(),
            original,
            "clearing an unlabelled member must not create settings"
        );
        fs::write(
            fixture.0.join("ops.toml"),
            "[workspace.labels]\ndefinitions = []\n",
        )
        .unwrap();
        assert!(
            fixture
                .config()
                .workspace_labels()
                .unwrap()
                .definitions
                .is_empty()
        );
        for glyph in ["P", "界", "★", "🙂", "e\u{301}"] {
            assert!(valid_label_glyph(glyph), "{glyph:?}");
        }
        for glyph in ["", " ", "ab", "\n", "👩\u{200d}💻"] {
            assert!(!valid_label_glyph(glyph), "{glyph:?}");
        }
    }

    #[test]
    fn assigning_first_default_label_preserves_legacy_bytes() {
        let fixture = FileFixture::new();
        let authored = "# authored\n[workspace]\npinned=['x'] # keep\nagent_pins={x='y'}\noverview_sort=42\n[other]\nkey='value' # untouched\n";
        fs::write(fixture.0.join("ops.toml"), authored).unwrap();
        let mut config = fixture.config();
        let expected = config.workspace_labels().unwrap();
        config
            .save_member_label(
                &expected,
                "66666666-6666-4666-8666-666666666666",
                Some("pr"),
            )
            .unwrap();
        let after = fs::read_to_string(config.path()).unwrap();
        let without_assignment = after
            .replace(
                "[workspace.labels.members]\n66666666-6666-4666-8666-666666666666 = \"pr\"\n",
                "",
            )
            .replace("\n[workspace.labels]\n\n", "");
        assert_eq!(without_assignment, authored);
        assert_eq!(
            fixture.config().workspace_labels().unwrap().members["66666666-6666-4666-8666-666666666666"],
            "pr"
        );
    }

    #[test]
    fn assigning_an_inline_member_label_preserves_unrelated_inline_fields() {
        let fixture = FileFixture::new();
        let authored = "[workspace]\nlabels = { note = 'keep', members = { \"66666666-6666-4666-8666-666666666666\" = 'review' } } # keep\n";
        fs::write(fixture.0.join("ops.toml"), authored).unwrap();
        let mut config = fixture.config();
        let expected = config.workspace_labels().unwrap();
        config
            .save_member_label(
                &expected,
                "66666666-6666-4666-8666-666666666666",
                Some("pr"),
            )
            .unwrap();
        assert_eq!(
            fs::read_to_string(config.path()).unwrap(),
            authored.replace("= 'review'", "= \"pr\"")
        );
    }

    #[test]
    fn assigning_with_inline_labels_and_no_members_is_safe() {
        let fixture = FileFixture::new();
        fs::write(
            fixture.0.join("ops.toml"),
            "[workspace]\nlabels = { note = 'keep' } # keep\n",
        )
        .unwrap();
        let mut config = fixture.config();
        let expected = config.workspace_labels().unwrap();
        config
            .save_member_label(
                &expected,
                "66666666-6666-4666-8666-666666666666",
                Some("pr"),
            )
            .unwrap();
        let read = fixture.config().workspace_labels().unwrap();
        assert_eq!(read.members["66666666-6666-4666-8666-666666666666"], "pr");
        let text = fs::read_to_string(config.path()).unwrap();
        assert!(text.contains("note = 'keep'"));
        assert!(text.contains("# keep"));
    }

    #[test]
    fn editing_a_definition_preserves_other_labels_assignments_and_comments() {
        let fixture = FileFixture::new();
        let authored = "# authored\n[workspace]\npinned=['keep'] # pin\n[workspace.labels]\ndefinitions = [{id='pr', glyph='P', color='waiting', name='PR'}, {id='review', glyph='R', color='unread', name='review'}] # definitions\n[workspace.labels.members]\n\"66666666-6666-4666-8666-666666666666\" = 'review' # member\n";
        fs::write(fixture.0.join("ops.toml"), authored).unwrap();
        let mut config = fixture.config();
        let expected = config.workspace_labels().unwrap();
        let mut changed = expected.definitions[1].clone();
        changed.name = "needs review".into();
        config
            .save_label_edit(&expected, LabelEdit::Upsert(changed))
            .unwrap();
        let output = fs::read_to_string(config.path()).unwrap();
        assert_eq!(
            output,
            authored.replace("name='review'", "name=\"needs review\"")
        );
        assert_eq!(
            fixture.config().workspace_labels().unwrap().members,
            expected.members
        );
    }

    #[test]
    fn reordering_keeps_assignments_and_confirmed_delete_removes_only_its_assignments() {
        let fixture = FileFixture::new();
        let mut config = fixture.config();
        let first = config.workspace_labels().unwrap();
        config
            .save_member_label(
                &first,
                "66666666-6666-4666-8666-666666666666",
                Some("review"),
            )
            .unwrap();
        let before_move = config.workspace_labels().unwrap();
        config
            .save_label_edit(
                &before_move,
                LabelEdit::Move {
                    id: "review".into(),
                    index: 0,
                },
            )
            .unwrap();
        let moved = config.workspace_labels().unwrap();
        assert_eq!(moved.definitions[0].id, "review");
        assert_eq!(moved.members, before_move.members);
        config
            .save_label_edit(
                &moved,
                LabelEdit::Delete {
                    id: "review".into(),
                },
            )
            .unwrap();
        let deleted = fixture.config().workspace_labels().unwrap();
        assert!(!deleted.definitions.iter().any(|label| label.id == "review"));
        assert!(deleted.members.is_empty());
        let text = fs::read_to_string(config.path()).unwrap();
        assert!(
            text.contains("# preserve user text\n[bind]\nj='copy'\n[squad.other]\nlayout='crew'\n")
        );
    }

    #[test]
    fn a_thirty_third_definition_and_invalid_glyphs_leave_the_file_unchanged() {
        let fixture = FileFixture::new();
        let mut config = fixture.config();
        for index in 5..32 {
            let current = config.workspace_labels().unwrap();
            config
                .save_label_edit(
                    &current,
                    LabelEdit::Upsert(BoardLabel {
                        id: format!("item-{index}"),
                        glyph: "P".into(),
                        color: "waiting".into(),
                        name: format!("Item {index}"),
                    }),
                )
                .unwrap();
        }
        let expected = config.workspace_labels().unwrap();
        assert_eq!(expected.definitions.len(), 32);
        let before = fs::read(config.path()).unwrap();
        let mut next = BoardLabel {
            id: "overflow".into(),
            glyph: "P".into(),
            color: "waiting".into(),
            name: "Overflow".into(),
        };
        assert!(
            config
                .save_label_edit(&expected, LabelEdit::Upsert(next.clone()))
                .is_err()
        );
        next.id = expected.definitions[0].id.clone();
        for glyph in ["", " ", "ab", "\n", "👩\u{200d}💻"] {
            next.glyph = glyph.into();
            assert!(
                config
                    .save_label_edit(&expected, LabelEdit::Upsert(next.clone()))
                    .is_err(),
                "{glyph:?}"
            );
        }
        assert_eq!(fs::read(config.path()).unwrap(), before);
    }
    #[test]
    fn preferences_reload_without_mutating_membership_or_unrelated_user_scopes() {
        let fixture = FileFixture::new();
        let mut config = fixture.config();
        let expected = config.workspace_preferences().unwrap();
        let next = OpsPreferences {
            hidden: BTreeSet::new(),
            sort: OpsSort::Attention,
            reversed: true,
            layout: OpsLayout::Stack,
            tok_range: TokRange::default(),
            savings_unit: super::super::SavingsUnit::Cost,
            overview_panels: None,
            digest_panels: None,
            labels: expected.labels.clone(),
        };
        config.save_workspace_preferences(&expected, &next).unwrap();
        let reloaded = fixture.config();
        assert_eq!(reloaded.workspace_preferences().unwrap(), next);
        let bytes = fs::read_to_string(reloaded.path()).unwrap();
        assert!(bytes.contains("# preserve user text"));
        assert!(bytes.contains("[bind]\nj='copy'"));
        assert!(bytes.contains("[squad.other]\nlayout='crew'"));
        assert_eq!(
            reloaded
                .workspace_keys(OpsKeyScope::Member, None, None)
                .unwrap()
                .bindings["j"]
                .verb,
            Verb::Copy
        );
    }
    #[test]
    fn shared_tok_range_roundtrips_without_changing_other_workspace_settings() {
        let fixture = FileFixture::new();
        let mut config = fixture.config();
        let initial = config.workspace_preferences().unwrap();
        let mut expected = initial.clone();
        for range in TokRange::ALL {
            let next = OpsPreferences {
                tok_range: range,
                ..expected.clone()
            };
            config.save_workspace_preferences(&expected, &next).unwrap();
            let loaded = fixture.config().workspace_preferences().unwrap();
            assert_eq!(loaded, next);
            assert_eq!(loaded.layout, initial.layout);
            assert!(
                fs::read_to_string(config.path())
                    .unwrap()
                    .contains("# preserve user text")
            );
            expected = loaded;
        }
        assert_eq!(expected.tok_range.next(), TokRange::Hour);
        for invalid in ["24h", "30d", "0h", "2h", "1H", ""] {
            assert_eq!(TokRange::parse(invalid), None);
        }
        fs::write(config.path(), "# untouched\n[workspace]\ntok_range='30d'\n").unwrap();
        let before = fs::read(config.path()).unwrap();
        assert!(fixture.config().workspace_preferences().is_err());
        assert_eq!(fs::read(config.path()).unwrap(), before);
    }

    #[test]
    fn retired_digest_panels_report_locations_and_unrelated_saves_preserve_bytes() {
        let fixture = FileFixture::new();
        let authored = "# preserve user text\n[workspace]\ndigest_panels = { order=['report','list','status','usage','subscriptions','chart'], hidden=['usage','chart'], details=false } # legacy\n";
        fs::write(fixture.0.join("ops.toml"), authored).unwrap();
        let mut config = fixture.config();
        let expected = config.workspace_preferences().unwrap();
        let panel_bytes = config.document["workspace"]["digest_panels"].to_string();
        let mut next = expected.clone();
        next.tok_range = TokRange::Week;
        config.save_workspace_preferences(&expected, &next).unwrap();
        let reloaded = fixture.config();
        assert_eq!(
            reloaded.document["workspace"]["digest_panels"].to_string(),
            panel_bytes
        );
        assert!(
            !reloaded
                .workspace_preferences()
                .unwrap()
                .digest_panels
                .unwrap()
                .effective()
                .shown(DigestPanel::Chart)
        );
        let notices = reloaded.workspace_migration_notices();
        for id in ["report", "status", "usage"] {
            assert!(
                notices
                    .iter()
                    .any(|notice| notice.contains("workspace.digest_panels.order")
                        && notice.contains(id))
            );
        }
    }

    #[test]
    fn an_authored_digest_window_loads_is_ignored_and_is_never_written() {
        // The window is the Digest tab's view state; an older file keeps loading unchanged.
        for text in [
            "[workspace]\ndigest_window='lifetime'",
            "[workspace]\ndigest_window='7d'",
            "[workspace]\ndigest_window=7",
        ] {
            let config = config(text);
            let before = config.document.to_string();
            assert_eq!(
                config.workspace_preferences().unwrap(),
                OpsPreferences::default(),
                "{text}"
            );
            assert_eq!(config.document.to_string(), before);
        }
        let fixture = FileFixture::new();
        let mut config = fixture.config();
        let expected = config.workspace_preferences().unwrap();
        let next = OpsPreferences {
            reversed: !expected.reversed,
            ..expected.clone()
        };
        config.save_workspace_preferences(&expected, &next).unwrap();
        assert!(
            !fs::read_to_string(config.path())
                .unwrap()
                .contains("digest_window")
        );
    }

    #[test]
    fn savings_unit_is_one_additive_preference() {
        use super::super::SavingsUnit;
        let fixture = FileFixture::new();
        let mut config = fixture.config();
        assert_eq!(
            config.workspace_preferences().unwrap().savings_unit,
            SavingsUnit::Tokens
        );
        for unit in [SavingsUnit::Percent, SavingsUnit::Cost, SavingsUnit::Tokens] {
            let expected = config.workspace_preferences().unwrap();
            let next = OpsPreferences {
                savings_unit: unit,
                ..expected.clone()
            };
            config.save_workspace_preferences(&expected, &next).unwrap();
            config = fixture.config();
            let loaded = config.workspace_preferences().unwrap();
            assert_eq!(loaded, next);
            assert!(
                fs::read_to_string(config.path())
                    .unwrap()
                    .contains("# preserve user text")
            );
        }
        for text in [
            "[workspace]\nsavings_unit='money'",
            "[workspace]\nsavings_unit=1",
        ] {
            let bad = self::config(text);
            let before = bad.document.to_string();
            assert!(bad.workspace_preferences().is_err());
            assert_eq!(bad.document.to_string(), before);
        }
        // The order is tokens, percent, cost.
        assert_eq!(SavingsUnit::Tokens.next(), SavingsUnit::Percent);
        assert_eq!(SavingsUnit::Percent.next(), SavingsUnit::Cost);
        assert_eq!(SavingsUnit::Cost.next(), SavingsUnit::Tokens);
    }

    #[test]
    fn preference_compare_and_swap_refuses_stale_model_and_intervening_file_edits() {
        let fixture = FileFixture::new();
        let mut first = fixture.config();
        let mut second = fixture.config();
        let expected = first.workspace_preferences().unwrap();
        let next = OpsPreferences {
            sort: OpsSort::Members,
            ..expected.clone()
        };
        first.save_workspace_preferences(&expected, &next).unwrap();
        let before = fs::read(first.path()).unwrap();
        assert_eq!(
            second
                .save_workspace_preferences(&expected, &next)
                .unwrap_err()
                .code,
            "SQUAD_CONFIG_CHANGED"
        );
        assert_eq!(fs::read(first.path()).unwrap(), before);
        let mut reloaded = fixture.config();
        assert!(
            reloaded
                .save_workspace_preferences(&expected, &next)
                .is_err()
        );
        assert_eq!(fs::read(first.path()).unwrap(), before);
    }
    #[test]
    fn hidden_squads_round_trip_unknown_ids_and_clear() {
        let fixture = FileFixture::new();
        let mut cfg = fixture.config();
        let untouched = fs::read(cfg.path()).unwrap();
        let original = cfg.workspace_preferences().unwrap();
        assert!(original.hidden.is_empty());
        assert_eq!(fs::read(cfg.path()).unwrap(), untouched);

        // Canonical room IDs do not require a live room to remain saved.
        let id = "11111111-1111-4111-8111-111111111111";
        let unknown = "22222222-2222-4222-8222-222222222222";
        let mut next = original.clone();
        next.hidden.extend([id.into(), unknown.into()]);
        cfg.save_workspace_preferences(&original, &next).unwrap();
        assert_eq!(fixture.config().workspace_preferences().unwrap(), next);
        let bytes = fs::read_to_string(cfg.path()).unwrap();
        assert!(bytes.contains("# preserve user text"));
        assert!(bytes.contains("[bind]\nj='copy'"));
        assert!(bytes.contains("[squad.other]\nlayout='crew'"));

        let hidden = next.clone();
        next.reversed = true;
        cfg.save_workspace_preferences(&hidden, &next).unwrap();
        assert_eq!(fixture.config().workspace_preferences().unwrap(), next);
        let hidden = next.clone();
        next.hidden.clear();
        cfg.save_workspace_preferences(&hidden, &next).unwrap();
        let cfg = fixture.config();
        assert_eq!(cfg.workspace_preferences().unwrap(), next);
        assert!(cfg.document["workspace"].get("hidden").is_none());
    }

    #[test]
    fn hidden_squads_validate_canonical_unique_bounded_room_ids_before_writing() {
        let id = "11111111-1111-4111-8111-111111111111";
        let ids = |count| {
            (0..count)
                .map(|n| format!("'{n:08x}-1111-4111-8111-111111111111'"))
                .collect::<Vec<_>>()
                .join(",")
        };
        assert_eq!(
            config(&format!("[workspace]\nhidden=[{}]", ids(1024)))
                .workspace_preferences()
                .unwrap()
                .hidden
                .len(),
            1024
        );
        for hidden in [
            "'not-an-array'".to_owned(),
            "[42]".into(),
            "['not-an-id']".into(),
            "['AAAAAAAA-1111-4111-8111-111111111111']".into(),
            format!("['{id}', '{id}']"),
            format!("[{}]", ids(1025)),
        ] {
            assert!(
                config(&format!("[workspace]\nhidden={hidden}"))
                    .workspace_preferences()
                    .is_err(),
                "{hidden}"
            );
        }

        let fixture = FileFixture::new();
        let mut cfg = fixture.config();
        let original = cfg.workspace_preferences().unwrap();
        let before = fs::read(cfg.path()).unwrap();
        for hidden in [
            ["not-an-id".into()].into(),
            (0..1025)
                .map(|n| format!("{n:08x}-1111-4111-8111-111111111111"))
                .collect(),
        ] {
            let next = OpsPreferences {
                hidden,
                ..original.clone()
            };
            assert!(cfg.save_workspace_preferences(&original, &next).is_err());
            assert_eq!(fs::read(cfg.path()).unwrap(), before);
        }
    }

    #[test]
    fn hidden_squad_writes_refuse_stale_preferences_and_external_file_edits() {
        let fixture = FileFixture::new();
        let mut first = fixture.config();
        let mut stale = fixture.config();
        let original = first.workspace_preferences().unwrap();
        let next = OpsPreferences {
            hidden: ["11111111-1111-4111-8111-111111111111".into()].into(),
            ..original.clone()
        };
        first.save_workspace_preferences(&original, &next).unwrap();
        let published = fs::read(first.path()).unwrap();
        assert_eq!(
            stale
                .save_workspace_preferences(&original, &next)
                .unwrap_err()
                .code,
            "SQUAD_CONFIG_CHANGED"
        );
        assert_eq!(fs::read(first.path()).unwrap(), published);
        let mut reloaded = fixture.config();
        assert!(
            reloaded
                .save_workspace_preferences(&original, &next)
                .is_err()
        );
        assert_eq!(fs::read(first.path()).unwrap(), published);

        let mut cleared = next.clone();
        cleared.hidden.clear();
        let edited = format!(
            "{}\n# external edit\n",
            String::from_utf8(published).unwrap()
        );
        fs::write(first.path(), &edited).unwrap();
        assert_eq!(
            reloaded
                .save_workspace_preferences(&next, &cleared)
                .unwrap_err()
                .code,
            "SQUAD_CONFIG_CHANGED"
        );
        assert_eq!(fs::read_to_string(first.path()).unwrap(), edited);
    }

    #[test]
    fn retired_pin_preferences_are_ignored_and_preserved_on_unrelated_save() {
        let fixture = FileFixture::new();
        let path = fixture.0.join("ops.toml");
        let saved = "[workspace]\npinned = 'legacy rooms' # keep rooms\nagent_pins = { invalid = true } # keep agents\noverview_sort = { old = true } # keep order\noverview_reverse = 'legacy' # keep reverse\n";
        fs::write(&path, saved).unwrap();
        let mut config = fixture.config();
        let original = config.workspace_preferences().unwrap();
        let mut changed = original.clone();
        changed.reversed = !changed.reversed;
        config
            .save_workspace_preferences(&original, &changed)
            .unwrap();
        let result = fs::read_to_string(&path).unwrap();
        assert!(result.contains("pinned = 'legacy rooms' # keep rooms\n"));
        assert!(result.contains("agent_pins = { invalid = true } # keep agents\n"));
        assert!(result.contains("overview_sort = { old = true } # keep order\n"));
        assert!(result.contains("overview_reverse = 'legacy' # keep reverse\n"));
    }

    #[test]
    fn removed_actions_follow_unknown_action_behavior() {
        for action in ["pin", "agents-filter", "talk-measure"] {
            assert_eq!(
                Action::parse(action).unwrap_err(),
                format!("'{action}' is not an action")
            );
        }
    }

    #[test]
    fn agent_and_squad_defaults_do_not_offer_pin_or_filter() {
        for scope in [OpsKeyScope::Member, OpsKeyScope::Squad] {
            let bindings = defaults(scope);
            assert!(!bindings.contains_key("p"), "{scope:?}");
            assert!(
                !bindings
                    .values()
                    .any(|binding| binding.text == "agents-filter"),
                "{scope:?}"
            );
        }
    }

    #[test]
    fn member_defaults_have_no_pin_or_view_reply_duplicate() {
        assert!(!defaults(OpsKeyScope::Member).contains_key("v"));
        assert!(!defaults(OpsKeyScope::Member).contains_key("p"));
    }

    #[test]
    fn tree_sort_keys_are_authored_only() {
        let cfg = config("[bind]\ns='sort'\nS='reverse-sort'");
        let keys = cfg.workspace_keys(OpsKeyScope::Member, None, None).unwrap();
        assert_eq!(keys.bindings["s"].text, "sort");
        assert_eq!(keys.bindings["S"].text, "reverse-sort");
    }
    #[test]
    fn panel_policy_errors_fall_back_with_one_notice_without_relaxing_other_keys() {
        for field in [
            "overview_panels = 5",
            "overview_panels = { hidden = ['future'] }",
            "overview_panels = { conversation = false, hidden = ['monitor'] }",
        ] {
            let cfg = config(&format!("[workspace]\n{field}\nsort='attention'\n"));
            let preferences = cfg.workspace_preferences().unwrap();
            assert_eq!(preferences.sort, OpsSort::Attention);
            assert_eq!(
                preferences.overview_panels.as_ref().unwrap().effective(),
                OverviewPanels::default()
            );
            let notices = cfg.workspace_migration_notices();
            assert_eq!(
                notices
                    .iter()
                    .filter(|notice| notice.contains("workspace.overview_panels"))
                    .count(),
                1
            );
            assert!(preferences.digest_panels.is_none());
        }
        for field in ["sort = 5", "unknown = true"] {
            assert!(
                config(&format!("[workspace]\noverview_panels=5\n{field}\n"))
                    .workspace_preferences()
                    .is_err()
            );
        }
    }
    #[test]
    fn unrelated_saves_preserve_absent_partial_older_and_invalid_panel_observations() {
        for panel in [
            "",
            "overview_panels = 5\n",
            "overview_panels = { hidden = [] } # inline\n",
            "overview_panels = { order = ['monitor'], hidden = [], conversation = true } # older order\n",
            "[workspace.overview_panels] # policy\nhidden = [] # partial\n",
        ] {
            let fixture = FileFixture::new();
            let text = format!("# user text\n[workspace]\nsort='name'\n{panel}");
            fs::write(fixture.0.join("ops.toml"), &text).unwrap();
            let mut cfg = fixture.config();
            let before = cfg.document["workspace"].get("overview_panels").cloned();
            let expected = cfg.workspace_preferences().unwrap();
            let mut next = expected.clone();
            next.reversed = true;
            cfg.save_workspace_preferences(&expected, &next).unwrap();
            let reloaded = fixture.config();
            assert_eq!(reloaded.workspace_preferences().unwrap(), next);
            assert_eq!(
                reloaded.document["workspace"]
                    .get("overview_panels")
                    .map(ToString::to_string),
                before.as_ref().map(ToString::to_string)
            );
            assert!(
                reloaded.document["workspace"]
                    .get("digest_panels")
                    .is_none()
            );
            assert!(
                fs::read_to_string(cfg.path())
                    .unwrap()
                    .contains("# user text")
            );
        }
    }
    #[test]
    fn panel_save_writes_full_policy_keeps_form_and_only_reset_removes_it() {
        for text in [
            "[workspace]\noverview_panels = {} # keep\n",
            "[workspace.overview_panels] # keep\n",
        ] {
            let fixture = FileFixture::new();
            fs::write(fixture.0.join("ops.toml"), text).unwrap();
            let mut cfg = fixture.config();
            let inline = cfg.document["workspace"]["overview_panels"].is_inline_table();
            let expected = cfg.workspace_preferences().unwrap();
            let mut next = expected.clone();
            next.overview_panels = Some(PanelSetting::configured(OverviewPanels::default()));
            cfg.save_workspace_preferences(&expected, &next).unwrap();
            let reloaded = fixture.config();
            assert_eq!(reloaded.workspace_preferences().unwrap(), next);
            let item = &reloaded.document["workspace"]["overview_panels"];
            assert_eq!(item.is_inline_table(), inline);
            for key in ["order", "hidden", "conversation"] {
                assert!(item.get(key).is_some());
            }
            assert!(fs::read_to_string(cfg.path()).unwrap().contains("# keep"));
            let explicit = next.clone();
            next.overview_panels = None;
            cfg.save_workspace_preferences(&explicit, &next).unwrap();
            let bytes = fs::read_to_string(cfg.path()).unwrap();
            assert!(!bytes.contains("overview_panels"));
        }
    }
    #[test]
    fn malformed_policy_change_is_stale_even_when_both_render_defaults() {
        let fixture = FileFixture::new();
        fs::write(
            fixture.0.join("ops.toml"),
            "[workspace]\noverview_panels = 5\n",
        )
        .unwrap();
        let expected = fixture.config().workspace_preferences().unwrap();
        let mut next = expected.clone();
        next.overview_panels = Some(PanelSetting::configured(OverviewPanels::default()));
        fs::write(
            fixture.0.join("ops.toml"),
            "[workspace]\noverview_panels = 6\n",
        )
        .unwrap();
        let mut fresh = fixture.config();
        let before = fs::read(fresh.path()).unwrap();
        assert!(fresh.save_workspace_preferences(&expected, &next).is_err());
        assert_eq!(fs::read(fresh.path()).unwrap(), before);
        let current = fresh.workspace_preferences().unwrap();
        let mut reset = current.clone();
        reset.overview_panels = None;
        fresh.save_workspace_preferences(&current, &reset).unwrap();
        assert!(
            !fs::read_to_string(fresh.path())
                .unwrap()
                .contains("overview_panels")
        );
    }
    #[test]
    fn both_dashboard_policies_round_trip_inside_an_inline_workspace() {
        let fixture = FileFixture::new();
        fs::write(
            fixture.0.join("ops.toml"),
            "workspace = { sort = 'name' } # workspace\n",
        )
        .unwrap();
        let mut cfg = fixture.config();
        let expected = cfg.workspace_preferences().unwrap();
        let mut next = expected.clone();
        let mut digest = DigestPanels::default();
        digest.set_shown(DigestPanel::Chart, false).unwrap();
        next.digest_panels = Some(PanelSetting::configured(digest));
        next.overview_panels = Some(PanelSetting::configured(OverviewPanels::default()));
        cfg.save_workspace_preferences(&expected, &next).unwrap();
        assert_eq!(fixture.config().workspace_preferences().unwrap(), next);
        assert!(fixture.config().document["workspace"].is_inline_table());
        assert!(
            fs::read_to_string(cfg.path())
                .unwrap()
                .contains("# workspace")
        );
    }
    #[test]
    fn removed_bindings_follow_the_existing_unknown_action_error() {
        for action in ["pin", "agents-filter", "talk-measure"] {
            let cfg = config(&format!("[bind]\nf = '{action}'"));
            let error = cfg
                .workspace_keys(OpsKeyScope::Member, None, None)
                .err()
                .unwrap();
            assert!(
                error.message.contains("is not an action"),
                "{}",
                error.message
            );
        }
    }
}
