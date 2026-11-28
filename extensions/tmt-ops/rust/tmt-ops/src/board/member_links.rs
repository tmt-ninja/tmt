//! Resolved member references over the held identity inventory. Display keeps
//! its own geometry; raw conversation source remains untouched.
mod command_popover;
pub(in crate::board) mod commands;
use super::inventory::Inventory;
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Resolved {
    pub range: Range<usize>,
    pub identity: String,
    pub name: String,
}

/// Full-width punctuation ends a link: CJK prose puts it right after an address, with no space.
const FULL_WIDTH_STOPS: [char; 10] = ['。', '，', '、', '）', '」', '』', '！', '？', '；', '：'];

/// A whitespace-separated word without its trailing spaces and closing punctuation: the
/// token the transcript and plain rows test for a bare web link. ASCII and full-width marks
/// trim together, so a mixed tail such as `#42)。` keeps only `#42`.
pub(super) fn word_token(word: &str) -> &str {
    word.trim_end_matches(|c: char| {
        c.is_whitespace()
            || ['.', ',', '!', ')', ']', ':', ';'].contains(&c)
            || FULL_WIDTH_STOPS.contains(&c)
    })
}

/// Where a bare link would sit in a token. It starts at the token's first character, or after
/// prose glued to it with no space, as CJK writes `連結：http://…`; after an ASCII letter or digit
/// (`xhttp://`) it is part of that word. It ends at full-width punctuation.
pub(super) fn link_range(token: &str) -> Range<usize> {
    let start = token
        .match_indices("http")
        .find(|&(at, _)| {
            let rest = &token[at..];
            (rest.starts_with("http://") || rest.starts_with("https://"))
                && token[..at]
                    .chars()
                    .next_back()
                    .is_some_and(|before| !before.is_ascii_alphanumeric())
        })
        .map_or(0, |(at, _)| at);
    let rest = &token[start..];
    let link = word_token(&rest[..rest.find(FULL_WIDTH_STOPS).unwrap_or(rest.len())]);
    start..start + link.len()
}

/// Whether a token is a bare web link the board opens, as the transcript links one.
pub(super) fn is_bare_url(token: &str) -> bool {
    token.starts_with("http") && token.len() <= 4096 && crate::effects::web_link(token).is_ok()
}

/// The byte ranges of the bare web links in plain text, by the transcript's rule.
pub(super) fn bare_urls(text: &str) -> Vec<Range<usize>> {
    let mut offset = 0;
    let mut found = Vec::new();
    for word in text.split_inclusive(char::is_whitespace) {
        let token = word_token(word);
        let link = link_range(token);
        if is_bare_url(&token[link.clone()]) {
            found.push(offset + link.start..offset + link.end);
        }
        offset += word.len();
    }
    found
}

/// The transcript still recognizes this explicit member syntax in authored text.
pub(super) const LEGACY_TRIGGER: &str = "#tmt:";

fn word_char(ch: char) -> bool {
    ch.is_alphanumeric() || matches!(ch, '-' | '_')
}

pub(super) fn resolve(text: &str, inventory: &Inventory) -> Vec<Resolved> {
    if inventory.error.is_some() {
        return Vec::new();
    }
    let mut found = Vec::new();
    let mut end = 0;
    for (start, ch) in text.char_indices() {
        if start < end {
            continue;
        }
        // A bare identity UUID, which the idle alert notice hands to `tmt focus` and `tmt talk`.
        if let Some(id) = text
            .get(start..start + 36)
            .filter(|id| crate::config::uuid_like(id))
            && let Some(agent) = inventory.agents.get(id)
            && !text[..start]
                .chars()
                .next_back()
                .is_some_and(|ch| word_char(ch) || ch == '@')
            && !text[start + 36..].chars().next().is_some_and(word_char)
        {
            end = start + 36;
            found.push(Resolved {
                range: start..end,
                identity: id.to_owned(),
                name: super::notes::sanitize(&agent.name),
            });
            continue;
        }
        let legacy = text[start..].starts_with(LEGACY_TRIGGER);
        // `tmt/<name>` is the mention the composer writes; `@name` stays for older text.
        let mention = text[start..].starts_with(super::mentions::TRIGGER);
        let prefix = if legacy {
            LEGACY_TRIGGER.len()
        } else if mention {
            super::mentions::TRIGGER.len()
        } else {
            usize::from(ch == '@')
        };
        if !legacy
            && text[..start].chars().next_back().is_some_and(|ch| {
                // A `tmt/` inside a path or an address is not a mention.
                word_char(ch) || ch == '@' || (mention && matches!(ch, '/' | '.' | '~'))
            })
        {
            continue;
        }
        let tail = &text[start + prefix..];
        let mut matches = Vec::new();
        for (id, agent) in &inventory.agents {
            let keys = [
                agent.canonical.as_str(),
                if legacy { id.as_str() } else { "" },
            ];
            for key in keys {
                if key.is_empty()
                    || (prefix == 0
                        && !key
                            .chars()
                            .any(|ch| ch.is_numeric() || matches!(ch, '-' | '_')))
                    || !tail.starts_with(key)
                    || tail[key.len()..].chars().next().is_some_and(word_char)
                {
                    continue;
                }
                matches.push((key.len(), id, agent));
            }
        }
        matches.sort_by_key(|(len, _, _)| std::cmp::Reverse(*len));
        let Some((len, id, agent)) = matches.first() else {
            continue;
        };
        if matches
            .iter()
            .any(|(other_len, other_id, _)| other_len == len && other_id != id)
        {
            continue;
        }
        end = start + prefix + len;
        found.push(Resolved {
            range: start..end,
            identity: (*id).clone(),
            name: if legacy {
                super::notes::sanitize(&agent.name)
            } else {
                text[start..end].to_owned()
            },
        });
    }
    found
}

/// A fence in a retained transcript projection. Rebuilding that projection revokes
/// its identities, so a late clipboard result cannot mark a newly admitted fence.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct FenceKey(u64);

impl FenceKey {
    pub(super) fn next() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(1);
        Self(NEXT.fetch_add(1, Ordering::Relaxed))
    }
}

/// What a painted reference stands for: a member, address, inert path or command.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Target {
    Member(String),
    Checklist(String),
    Work(String),
    Url(String),
    File(String),
    Command(commands::Command),
    FenceCopy {
        key: FenceKey,
        text: std::sync::Arc<str>,
    },
    FenceRun {
        key: FenceKey,
        command: String,
    },
}

impl Target {
    fn fence_button(&self) -> bool {
        matches!(self, Self::FenceCopy { .. } | Self::FenceRun { .. })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Origin {
    pub source: Range<usize>,
    /// Caption bytes in its projected row, before the message gutter is painted.
    pub shown: Range<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Link {
    pub column: usize,
    pub width: usize,
    pub target: Target,
    pub occurrence: usize,
    /// Original message bytes replaced by this atomic caption.
    pub source: Option<Origin>,
}

use super::{
    app::{App, Choice, Effect, Menu, MenuEntry, RowTarget},
    workspace::OpsTarget,
};
use ratatui::{
    Frame,
    crossterm::event::{KeyCode, KeyEvent, MouseButton, MouseEvent, MouseEventKind},
    layout::Rect,
    style::Modifier,
};
use std::cell::RefCell;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Hit {
    area: Rect,
    surface: Rect,
    target: Target,
    checklist: Option<(
        super::conversation_checklist::Key,
        crate::checklist::model::Id,
    )>,
    reader: bool,
    occurrence: usize,
    transcript: Option<super::conversation::ConversationKey>,
}

impl Hit {
    fn same_transcript_url(&self, other: &Self) -> bool {
        self.transcript.is_some()
            && self.transcript == other.transcript
            && self.target == other.target
            && self.occurrence == other.occurrence
    }

    fn focuses(&self, other: &Self) -> bool {
        if self.transcript.is_some() {
            return self.same_transcript_url(other);
        }
        self.reader == other.reader
            && self.surface == other.surface
            && self.target == other.target
            && self.occurrence == other.occurrence
    }
}
struct Cached {
    text: String,
    width: usize,
    look: crate::look::Look,
    mapped: Option<std::rc::Rc<super::markdown::Mapped>>,
    resolved: Option<std::rc::Rc<[Resolved]>>,
    urls: Option<std::rc::Rc<[Range<usize>]>>,
    used: bool,
}

#[derive(Default)]
pub(super) struct State {
    hits: Vec<Hit>,
    focused: Option<Hit>,
    pressed: Option<(Hit, ratatui::layout::Position, bool)>,
    screen: Rect,
    hovered: Option<Hit>,
    copied_fence: Option<(FenceKey, std::time::Instant)>,
    inventory: Option<std::sync::Arc<()>>,
    cache: Vec<Cached>,
    /// The opened link's checklist entry survives Show full and a background transcript refresh.
    /// A new hit replaces it, including another occurrence of the same URL.
    link_note: Option<(String, Choice)>,
    #[cfg(test)]
    builds: usize,
}

#[cfg(test)]
impl State {
    pub(in crate::board) fn fence_copy_hit(&self) -> Option<(FenceKey, Rect)> {
        self.hits.iter().find_map(|hit| match hit.target {
            Target::FenceCopy { key, .. } => Some((key, hit.area)),
            _ => None,
        })
    }
}
#[derive(PartialEq, Eq)]
pub(super) struct TranscriptFocusTrace {
    reader_hits: usize,
    retained: bool,
    rebound: bool,
}
impl TranscriptFocusTrace {
    pub(super) fn document(&self) -> serde_json::Value {
        serde_json::json!({
            "reader_hits": self.reader_hits,
            "retained": self.retained,
            "rebound": self.rebound,
        })
    }
}

impl State {
    pub(super) fn transcript_focus_trace(&self) -> TranscriptFocusTrace {
        let focused = self.focused.as_ref().filter(|hit| hit.transcript.is_some());
        TranscriptFocusTrace {
            reader_hits: self
                .hits
                .iter()
                .filter(|hit| hit.reader && hit.transcript.is_some())
                .count(),
            retained: focused.is_some(),
            rebound: focused.is_some_and(|hit| self.hits.contains(hit)),
        }
    }

    pub fn begin_frame(&mut self, screen: Rect) {
        self.hits.clear();
        self.screen = screen;
        self.cache.retain(|entry| entry.used);
        for entry in &mut self.cache {
            entry.used = false;
        }
    }
    /// The web links painted this frame, for the terminal to make clickable. The
    /// pieces of one link share an id; a label shown twice does not.
    pub fn web_spans(&self) -> Vec<super::hyperlinks::Span> {
        use std::hash::{Hash, Hasher};
        self.hits
            .iter()
            .filter_map(|hit| {
                let Target::Url(url) = &hit.target else {
                    return None;
                };
                let mut id = std::collections::hash_map::DefaultHasher::new();
                (hit.surface.as_position(), url, hit.occurrence).hash(&mut id);
                super::hyperlinks::Span::new(hit.area, url, id.finish() as u32)
            })
            .collect()
    }
    pub fn invalidate(&mut self) {
        self.hits.clear();
        self.focused = None;
        self.pressed = None;
        self.hovered = None;
    }
    pub(super) fn invalidate_preserving_transcript_focus(&mut self) {
        // Retain the keyboard intent only. The next paint must publish a new hit.
        let focused = self.focused.take().filter(|hit| hit.transcript.is_some());
        self.invalidate();
        self.focused = focused;
    }

    pub(super) fn finish_frame(&mut self) {
        if self
            .focused
            .as_ref()
            .is_some_and(|hit| hit.transcript.is_some() && !self.hits.contains(hit))
        {
            self.focused = None;
        }
    }
    fn cached(
        &mut self,
        text: &str,
        width: usize,
        look: crate::look::Look,
        inventory: &Inventory,
    ) -> &mut Cached {
        if self
            .inventory
            .as_ref()
            .is_none_or(|held| !std::sync::Arc::ptr_eq(held, &inventory.generation))
        {
            self.cache.clear();
            self.inventory = Some(std::sync::Arc::clone(&inventory.generation));
        }
        let index = self
            .cache
            .iter()
            .position(|entry| entry.text == text && entry.width == width && entry.look == look)
            .unwrap_or_else(|| {
                self.cache.push(Cached {
                    text: text.to_owned(),
                    width,
                    look,
                    mapped: None,
                    resolved: None,
                    urls: None,
                    used: true,
                });
                #[cfg(test)]
                {
                    self.builds += 1;
                }
                self.cache.len() - 1
            });
        let entry = &mut self.cache[index];
        entry.used = true;
        entry
    }
    fn preview(
        &mut self,
        text: &str,
        width: usize,
        look: crate::look::Look,
        inventory: &Inventory,
    ) -> std::rc::Rc<super::markdown::Mapped> {
        let entry = self.cached(text, width, look, inventory);
        std::rc::Rc::clone(entry.mapped.get_or_insert_with(|| {
            std::rc::Rc::new(super::markdown::render_plain_with_members(
                text, width, look, inventory,
            ))
        }))
    }
    /// A plain row's member names and bare web links, from one cached entry.
    fn plain(
        &mut self,
        text: &str,
        look: crate::look::Look,
        inventory: &Inventory,
    ) -> (std::rc::Rc<[Resolved]>, std::rc::Rc<[Range<usize>]>) {
        let entry = self.cached(text, usize::MAX, look, inventory);
        let resolved = std::rc::Rc::clone(
            entry
                .resolved
                .get_or_insert_with(|| resolve(text, inventory).into()),
        );
        let urls = std::rc::Rc::clone(entry.urls.get_or_insert_with(|| bare_urls(text).into()));
        (resolved, urls)
    }
    pub(super) fn move_pointer(&mut self, point: ratatui::layout::Position, active: bool) -> bool {
        let next = active
            .then(|| {
                self.hits
                    .iter()
                    .rev()
                    .find(|hit| hit.area.contains(point))
                    .cloned()
            })
            .flatten();
        let changed = self.hovered != next;
        self.hovered = next;
        changed
    }
}

/// Geometry is clipped to cells actually painted in the current viewport.
pub(super) struct Paint<'a> {
    pub reader: bool,
    pub role: tmt_cli_style::Role,
    pub transcript: Option<&'a super::conversation::ConversationKey>,
}

pub(super) fn paint_hits(
    frame: &mut Frame,
    app: &App,
    area: Rect,
    offset: usize,
    shown: usize,
    lines: &[Vec<Link>],
    presentation: Paint<'_>,
) {
    let mut state = app.member_links.borrow_mut();
    for (index, links) in lines
        .iter()
        .enumerate()
        .skip(offset)
        .take(shown.min(usize::from(area.height)))
    {
        for link in links {
            let checklist = if let Target::Checklist(prefix) = &link.target {
                if !presentation.reader {
                    continue;
                }
                let Some((key, item)) = app.checklist_item_reference(prefix) else {
                    continue;
                };
                Some((key, item.item.id.clone()))
            } else {
                None
            };
            if link.column >= usize::from(area.width) {
                continue;
            }
            let width = link.width.min(usize::from(area.width) - link.column) as u16;
            if width == 0 {
                continue;
            }
            let hit = Hit {
                surface: area,
                area: Rect::new(
                    area.x + link.column as u16,
                    area.y + (index - offset) as u16,
                    width,
                    1,
                ),
                target: link.target.clone(),
                checklist,
                reader: presentation.reader,
                occurrence: link.occurrence,
                transcript: presentation
                    .transcript
                    .filter(|_| matches!(link.target, Target::Url(_)))
                    .cloned(),
            };
            let focused = state
                .focused
                .as_ref()
                .is_some_and(|focus| focus.focuses(&hit));
            if focused
                && hit.transcript.is_some()
                && !state
                    .hits
                    .iter()
                    .any(|shown| hit.same_transcript_url(shown))
            {
                // Bind to the first painted fragment, the same one keyboard cycling uses.
                state.focused = Some(hit.clone());
            }
            if hit.target.fence_button() {
                paint_fence_button(frame, app, &state, &hit, focused);
                state.hits.push(hit);
                continue;
            }
            for x in hit.area.x..hit.area.right() {
                let hover = state
                    .hovered
                    .as_ref()
                    .is_some_and(|hover| hover.area == hit.area && hover.target == hit.target);
                let style = app
                    .look()
                    .role(presentation.role)
                    .remove_modifier(Modifier::BOLD)
                    .add_modifier(Modifier::UNDERLINED);
                if matches!(
                    hit.target,
                    Target::Url(_) | Target::File(_) | Target::Command(_)
                ) {
                    // A web link keeps the colour the renderer gave its label.
                    if focused || hover {
                        frame.buffer_mut()[(x, hit.area.y)]
                            .set_style(app.look().selection().add_modifier(Modifier::UNDERLINED));
                    }
                    continue;
                }
                frame.buffer_mut()[(x, hit.area.y)]
                    .set_fg(style.fg.unwrap_or(ratatui::style::Color::Reset))
                    .set_style(ratatui::style::Style::new().remove_modifier(Modifier::BOLD));
                frame.buffer_mut()[(x, hit.area.y)].set_style(if focused || hover {
                    style
                        .patch(app.look().selection())
                        .remove_modifier(Modifier::BOLD)
                } else {
                    style
                });
            }
            state.hits.push(hit);
        }
    }
}

fn paint_fence_button(frame: &mut Frame, app: &App, state: &State, hit: &Hit, focused: bool) {
    let look = app.look();
    let buffer = frame.buffer_mut();
    let copied = matches!(hit.target, Target::FenceCopy { key, .. }
        if state.copied_fence.is_some_and(|(copied, _)| copied == key));
    if copied {
        let caption = if hit.area.width >= 8 {
            "✓ copied"
        } else {
            "✓"
        };
        let background = look
            .role(tmt_cli_style::Role::Code)
            .patch(look.role(tmt_cli_style::Role::Track));
        let style = background.patch(look.role(tmt_cli_style::Role::Working));
        for x in hit.area.x..hit.area.right() {
            buffer.set_string(x, hit.area.y, " ", style);
        }
        buffer.set_string(
            hit.area.right() - caption.chars().count() as u16,
            hit.area.y,
            caption,
            style,
        );
    }
    if focused && !copied {
        for x in hit.area.x..hit.area.right() {
            buffer[(x, hit.area.y)].set_style(look.selection());
        }
    }
}

pub(super) fn menu_area(screen: Rect, anchor: Rect, desired_height: u16) -> Option<Rect> {
    if anchor.intersection(screen) != anchor {
        return None;
    }
    let below = screen.bottom().saturating_sub(anchor.bottom());
    let above = anchor.y.saturating_sub(screen.y);
    let (available, below) = if below >= desired_height || below >= above {
        (below, true)
    } else {
        (above, false)
    };
    let height = desired_height.min(available);
    if height < 5 {
        return None;
    }
    let width = screen.width.min(48);
    Some(Rect::new(
        anchor.x.min(screen.right().saturating_sub(width)),
        if below {
            anchor.bottom()
        } else {
            anchor.y - height
        },
        width,
        height,
    ))
}

impl App {
    pub(in crate::board) fn member_link_target(&self, identity: &str) -> Option<OpsTarget> {
        if self.references.error.is_some() || !self.references.agents.contains_key(identity) {
            return None;
        }
        let snapshot = self.workspace_snapshot()?;
        if !snapshot.roster.complete() {
            return None;
        }
        // Prefer the current membership, then a visible membership, then the
        // acquired identity's first membership. Never invent Common pool.
        let same = |target: &&OpsTarget| matches!(target, OpsTarget::Member { identity_id, .. } if identity_id == identity);
        self.workspace
            .selected
            .as_ref()
            .filter(|target| same(target))
            .filter(|target| snapshot.roster.contains(target))
            .cloned()
            .or_else(|| {
                self.workspace_rows()
                    .iter()
                    .map(|row| &row.target)
                    .find(|target| same(target) && snapshot.roster.contains(target))
                    .cloned()
            })
            .or_else(|| {
                snapshot
                    .rows
                    .keys()
                    .find(|target| same(target) && snapshot.roster.contains(target))
                    .cloned()
            })
    }
    /// The selected row advertises the effective jump key, with the same held-data eligibility
    /// as the action. The keycap is omitted altogether when the host action is unavailable.
    pub(in crate::board) fn member_open_hint(
        &self,
        target: &OpsTarget,
    ) -> Option<ratatui::text::Line<'static>> {
        use crate::{action::Verb, config::OpsKeyScope};
        if !self.workspace_strip_enabled()
            || self.workspace.selected.as_ref() != Some(target)
            || !matches!(target, OpsTarget::Member { .. })
        {
            return None;
        }
        let row = self.target_row(&RowTarget::Workspace(target.clone()))?;
        if row["presence"] != "active" {
            return None;
        }
        if self.invoker_tmux && !self.selected_built_in() {
            super::overview::actions::host(row, self.invoker_tmux).ok()?;
        }
        let mut keys = self.workspace_context_bindings(
            Some(target),
            OpsKeyScope::Member,
            row["pane"]["location"]["host"].as_str(),
        );
        // A shortcut for the lead is a different destination.
        keys.retain(|_, action| action.verb != Verb::Jump || action.args.is_empty());
        let key = super::view::footer::configured_key(
            self,
            &keys,
            self.workspace_binding_sources_for(OpsKeyScope::Member),
            Verb::Jump,
            "z",
        )?;
        let key = super::view::footer::key_label(&key);
        Some(ratatui::text::Line::from(vec![
            super::keycap::control_span(self, key, None),
            ratatui::text::Span::styled("open", self.look().role(tmt_cli_style::Role::Muted)),
        ]))
    }

    fn member_link_jump(&self, target: &OpsTarget) -> Result<crate::action::Action, String> {
        use crate::config::OpsKeyScope;
        let row = self
            .target_row(&RowTarget::Workspace(target.clone()))
            .ok_or("Member unavailable")?;
        if row["presence"] != "active"
            || !row["pane"].is_object()
            || row["pane"]["location"]["host"].as_str().is_none()
        {
            return Err("target is offline or has no live binding".into());
        }
        let keys = self.workspace_context_bindings(
            Some(target),
            OpsKeyScope::Member,
            row["pane"]["location"]["host"].as_str(),
        );
        let action = keys.get("z").ok_or("No z action configured")?;
        crate::config::admit_workspace_action(action, "member mention z")
            .map_err(|error| error.message)?;
        if !matches!(
            action.verb,
            crate::action::Verb::Jump | crate::action::Verb::Run
        ) {
            return Err("z is not a host action".into());
        }
        if action.verb == crate::action::Verb::Run {
            action.argv(row)?;
        } else {
            super::overview::actions::host(row, self.invoker_tmux).map_err(str::to_owned)?;
        }
        Ok(action.clone())
    }
    fn member_link_binding(
        &self,
        target: &OpsTarget,
        verb: crate::action::Verb,
    ) -> Option<crate::action::Action> {
        use crate::{action::Verb, config::OpsKeyScope};
        let row_target = RowTarget::Workspace(target.clone());
        let row = self.target_row(&row_target)?;
        let keys = self.workspace_context_bindings(
            Some(target),
            OpsKeyScope::Member,
            row["pane"]["location"]["host"].as_str(),
        );
        let preferred = match verb {
            Verb::Talk => "enter",
            Verb::Copy => "y",
            Verb::Annotate => "a",
            _ => return None,
        };
        let action = keys
            .get(preferred)
            .filter(|action| action.verb == verb)
            .or_else(|| keys.values().find(|action| action.verb == verb))?;
        crate::config::admit_workspace_action(action, "member link").ok()?;
        match verb {
            Verb::Talk => {
                self.send_target(row_target, false)?;
            }
            Verb::Annotate => {
                if action.args.first().and_then(|arg| arg.literal()) == Some("member") {
                    return None;
                }
                self.send_target(row_target, false)?.note?;
            }
            Verb::Copy => {
                action.args.first()?.fill(row).ok()?;
            }
            _ => return None,
        }
        Some(action.clone())
    }
    fn member_link_valid(&self, target: &OpsTarget) -> bool {
        matches!(target, OpsTarget::Member {identity_id, ..} if self.references.error.is_none()
            && self.references.agents.contains_key(identity_id)
            && self.workspace_snapshot().is_some_and(|snapshot| snapshot.roster.complete() && snapshot.roster.contains(target)))
    }
    pub(super) fn member_link_command(
        &mut self,
        target: &OpsTarget,
        action: &crate::action::Action,
    ) -> Effect {
        if !self.member_link_valid(target)
            || self.member_link_binding(target, action.verb).as_ref() != Some(action)
        {
            return self.say("This member action changed or became unavailable; reopen its menu.");
        }
        if matches!(
            action.verb,
            crate::action::Verb::Talk | crate::action::Verb::Annotate
        ) {
            self.member_link_action(target, false);
        }
        self.perform_context(action, Some(target))
    }
    pub(super) fn open_work_reference(
        &mut self,
        number: &str,
        expected: &super::work_references::OpenTarget,
    ) -> Effect {
        let current = self.work.references().and_then(|index| index.get(number));
        if current.is_some_and(|reference| &reference.target == expected) {
            Effect::OpenWorkPage(expected.clone())
        } else {
            self.say("This Work reference changed or became unavailable.")
        }
    }

    fn open_member_link(&mut self, hit: Hit) -> Effect {
        match &hit.target {
            Target::FenceCopy { key, text } => {
                return Effect::Act(super::app::Request::Copy {
                    text: text.to_string(),
                    program: self.view.as_ref().and_then(|view| view.clipboard.clone()),
                    feedback: super::app::CopyFeedback::Fence(*key),
                });
            }
            Target::FenceRun { command, .. } => {
                let Some(target) = self
                    .terminals_owner()
                    .and_then(|id| self.member_link_target(id))
                else {
                    return self.say("Select a member before opening Run.");
                };
                return self.command_form(&target, command);
            }
            _ => {}
        }
        if let Target::Command(shown) = &hit.target {
            return self.command_popover(shown, hit.area);
        }
        if let Target::File(path) = &hit.target {
            return self.file_popover(path, hit.area);
        }
        if let Target::Work(number) = &hit.target {
            let Some(reference) = self.work.references().and_then(|index| index.get(number)) else {
                return self.say("This Work reference is unavailable.");
            };
            let entry = |label: &str, choice| MenuEntry {
                chip: None,
                separator: false,
                key: String::new(),
                label: label.into(),
                choice,
            };
            self.menu = Some(Menu {
                link: None,
                prefill: String::new(),
                title: format!("#{}", reference.number),
                entries: vec![
                    entry(
                        "Open in Colab",
                        Choice::OpenWorkReference {
                            number: reference.number.clone(),
                            target: reference.target.clone(),
                        },
                    ),
                    entry("Copy number", Choice::LinkCopy(reference.number.clone())),
                ],
                selected: 0,
                anchor: Some(hit.area),
                surface: RefCell::new(None),
            });
            return Effect::None;
        }
        if let Some((key, id)) = hit.checklist {
            let Some((_, item)) = self
                .checklist_item_reference(id.as_str())
                .filter(|(current, _)| *current == key)
            else {
                return self.say("This checklist item is unavailable.");
            };
            let title = super::notes::single_line(&item.item.content.title);
            self.menu = Some(Menu {
                link: None,
                prefill: String::new(),
                title,
                entries: vec![MenuEntry {
                    chip: None,
                    separator: false,
                    key: String::new(),
                    label: "Open in checklist".into(),
                    choice: Choice::OpenChecklistItem { key, id },
                }],
                selected: 0,
                anchor: Some(hit.area),
                surface: RefCell::new(None),
            });
            return Effect::None;
        }
        let Target::Member(identity) = &hit.target else {
            return self.open_url_link(&hit);
        };
        let Some(target) = self.member_link_target(identity) else {
            return self.say("This member is unavailable; refresh the board.");
        };
        let jump = self.member_link_jump(&target);
        let title = self.references.agents[identity].name.clone();
        let mut entries = Vec::new();
        let command = |key: &str, label: &str, action| MenuEntry {
            chip: None,
            separator: false,
            key: key.into(),
            label: label.into(),
            choice: Choice::MemberLinkAction {
                target: target.clone(),
                action,
            },
        };
        if let Some(action) = self.member_link_binding(&target, crate::action::Verb::Talk) {
            entries.push(command("t", "Message", action));
        }
        if jump.is_ok() {
            entries.push(MenuEntry {
                chip: None,
                separator: false,
                key: "z".into(),
                label: "Jump to host".into(),
                choice: Choice::MemberLink {
                    target: target.clone(),
                    jump: true,
                },
            });
        }
        for (key, label, verb) in [
            ("y", "Copy", crate::action::Verb::Copy),
            ("a", "Note to lead", crate::action::Verb::Annotate),
        ] {
            if let Some(action) = self.member_link_binding(&target, verb) {
                entries.push(command(key, label, action));
            }
        }
        entries.push(MenuEntry {
            chip: None,
            separator: false,
            key: String::new(),
            label: "Show in Agents".into(),
            choice: Choice::MemberLink {
                target: target.clone(),
                jump: false,
            },
        });
        if menu_area(
            self.member_links.borrow().screen,
            hit.area,
            entries.len() as u16 + 4,
        )
        .is_none()
        {
            return self.say("Not enough room beside this mention; resize to open its actions.");
        }
        self.menu = Some(Menu {
            link: None,
            prefill: String::new(),
            title,
            entries,
            selected: 0,
            anchor: Some(hit.area),
            surface: RefCell::new(None),
        });
        Effect::None
    }
    pub(super) fn member_link_mouse(&mut self, event: MouseEvent) -> Option<Effect> {
        let point = (event.column, event.row).into();
        match event.kind {
            MouseEventKind::Down(MouseButton::Left) => {
                let hit = self
                    .member_links
                    .borrow()
                    .hits
                    .iter()
                    .find(|hit| hit.area.contains(point))
                    .cloned();
                self.member_links.borrow_mut().pressed = None;
                let hit = hit?;
                if hit.target.fence_button() {
                    self.member_links.borrow_mut().pressed = Some((hit, point, false));
                    Some(Effect::None)
                } else if hit.reader && self.rendered_selection_at(point) {
                    // A conversation link remains clickable, but the first drag
                    // must select its rendered name rather than open a menu.
                    self.member_links.borrow_mut().pressed = Some((hit, point, false));
                    None
                } else {
                    Some(self.open_member_link(hit))
                }
            }
            MouseEventKind::Drag(MouseButton::Left) | MouseEventKind::Moved => {
                if let Some((hit, start, dragged)) = &mut self.member_links.borrow_mut().pressed
                    && (hit.target.fence_button()
                        || event.kind == MouseEventKind::Drag(MouseButton::Left))
                {
                    *dragged |= point != *start
                        || (hit.target.fence_button()
                            && event.kind == MouseEventKind::Drag(MouseButton::Left));
                }
                None
            }
            MouseEventKind::Up(MouseButton::Left) => {
                let (mut hit, start, dragged) = self.member_links.borrow_mut().pressed.take()?;
                if dragged
                    || !hit.area.contains(point)
                    || (hit.target.fence_button() && start != point)
                {
                    return None;
                }
                let current = self
                    .member_links
                    .borrow()
                    .hits
                    .iter()
                    .find(|current| {
                        // New transcript lines can grow the surface below an unchanged link.
                        hit.surface.height = current.surface.height;
                        **current == hit
                    })
                    .cloned()?;
                self.conversation_source_escape();
                Some(self.open_member_link(current))
            }
            _ => None,
        }
    }
    fn row_name_hits(&self) -> Vec<Hit> {
        let index = if self.workspace_snapshot().is_some() {
            self.workspace_rows()
                .iter()
                .position(|row| Some(&row.target) == self.workspace.selected.as_ref())
        } else {
            Some(self.selected)
        };
        let Some(index) = index else {
            return Vec::new();
        };
        let rows: Vec<_> = self
            .hits
            .borrow()
            .iter()
            .filter_map(|hit| {
                (hit.target == super::app::HitTarget::Row(index))
                    .then_some(Rect::new(hit.x, hit.y, hit.width, 1))
            })
            .collect();
        self.member_links
            .borrow()
            .hits
            .iter()
            .filter(|hit| {
                !hit.reader
                    && rows
                        .iter()
                        .any(|row| row.intersection(hit.area) == hit.area)
            })
            .cloned()
            .collect()
    }
    fn reader_link_default_key(&self, event: &str) -> bool {
        self.input.is_none()
            && !self
                .workspace_binding_sources()
                .and_then(|sources| sources.get(event))
                .is_some_and(|source| source != "workspace default")
    }
    pub(in crate::board) fn member_link_owns_enter(&self) -> bool {
        if !self.reader_link_default_key("enter") {
            return false;
        }
        let state = self.member_links.borrow();
        state.focused.as_ref().is_some_and(|focused| {
            state
                .hits
                .iter()
                .any(|hit| hit.reader == (self.focus == 1) && hit == focused)
        })
    }
    pub(super) fn member_link_key(&mut self, key: KeyEvent) -> Option<Effect> {
        if self.focus == 0
            && matches!(
                key.code,
                KeyCode::Up
                    | KeyCode::Down
                    | KeyCode::PageUp
                    | KeyCode::PageDown
                    | KeyCode::Home
                    | KeyCode::End
            )
        {
            self.member_links.borrow_mut().focused = None;
            return None;
        }
        if key.code == KeyCode::Char('@')
            && self.focus == 0
            && self.input.is_none()
            && (key.modifiers.is_empty()
                || key.modifiers == ratatui::crossterm::event::KeyModifiers::SHIFT)
            && !self.bindings().contains_key("@")
        {
            let hits = self.row_name_hits();
            let first = hits.first()?.clone();
            if hits.len() == 1 {
                self.member_links.borrow_mut().focused = None;
                return Some(self.open_member_link(first));
            }
            self.member_links.borrow_mut().focused = Some(first);
            return Some(Effect::None);
        }
        if !key.modifiers.is_empty()
            || super::app::event_name(key).is_none_or(|event| !self.reader_link_default_key(&event))
        {
            return None;
        }
        let mut seen = std::collections::BTreeSet::new();
        let candidates = if self.focus == 0 {
            self.row_name_hits()
        } else {
            self.member_links
                .borrow()
                .hits
                .iter()
                .filter(|hit| hit.reader)
                .cloned()
                .collect()
        };
        let hits: Vec<_> = candidates
            .into_iter()
            .filter(|hit| {
                seen.insert((
                    hit.target.clone(),
                    hit.occurrence,
                    hit.surface.x,
                    hit.surface.y,
                    hit.surface.width,
                    hit.surface.height,
                ))
            })
            .collect();
        let mut state = self.member_links.borrow_mut();
        if self.focus == 0
            && state
                .focused
                .as_ref()
                .is_none_or(|focused| !hits.contains(focused))
        {
            return None;
        }
        if hits.is_empty() {
            state.focused = None;
            return None;
        }
        let index = state
            .focused
            .as_ref()
            .and_then(|focused| hits.iter().position(|hit| hit == focused));
        match key.code {
            KeyCode::Left | KeyCode::Right => {
                let i = index.map_or(0, |i| {
                    if key.code == KeyCode::Left {
                        (i + hits.len() - 1) % hits.len()
                    } else {
                        (i + 1) % hits.len()
                    }
                });
                state.focused = Some(hits[i].clone());
                Some(Effect::None)
            }
            KeyCode::Enter if index.is_some() => {
                let hit = hits[index.unwrap()].clone();
                drop(state);
                Some(self.open_member_link(hit))
            }
            KeyCode::Esc if index.is_some() => {
                state.focused = None;
                Some(Effect::None)
            }
            _ => None,
        }
    }
    pub(super) fn fence_copied(&mut self, key: FenceKey, lines: usize, now: std::time::Instant) {
        self.member_links.borrow_mut().copied_fence =
            Some((key, now + std::time::Duration::from_secs(2)));
        let unit = if lines == 1 { "line" } else { "lines" };
        self.finished(Ok(format!("Copied {lines} {unit}.")));
    }

    pub(super) fn expire_fence_copy(&self, now: std::time::Instant) -> bool {
        let mut state = self.member_links.borrow_mut();
        if state.copied_fence.is_some_and(|(_, until)| now >= until) {
            state.copied_fence = None;
            true
        } else {
            false
        }
    }

    pub(super) fn member_link_action(&mut self, target: &OpsTarget, jump: bool) -> Effect {
        if !self.member_link_valid(target) {
            return self.say(
                "This member or membership changed or became unavailable; refresh the board.",
            );
        }
        if jump {
            let action = match self.member_link_jump(target) {
                Ok(action) => action,
                Err(reason) => return self.say(reason),
            };
            return self.perform_member_host(&action, target);
        }
        // An explicit navigation is session-only. It never changes shared hide
        // preferences or loses a retained conversation draft.
        self.remember_draft();
        self.input = None;
        self.searching = false;
        self.search.clear();
        self.workspace.query.clear();

        self.workspace.visibility.scope.clear();
        self.workspace.visibility.reveal_hidden = true;
        self.shell.tab = super::shell::OpsTab::Agents;
        self.focus = 0;
        self.choose(Choice::WorkspaceTarget(target.clone()))
    }
}

/// Plain preview projection: only resolved member markup changes its display.
pub(super) fn paint_preview(
    frame: &mut Frame,
    app: &App,
    area: Rect,
    text: &str,
    role: tmt_cli_style::Role,
) -> bool {
    let mapped = app.member_links.borrow_mut().preview(
        text,
        usize::from(area.width).max(1),
        app.look(),
        &app.references,
    );
    if mapped.mentions.iter().all(Vec::is_empty) {
        return false;
    }
    for (index, line) in mapped
        .lines
        .iter()
        .take(usize::from(area.height))
        .enumerate()
    {
        tmt_tui::components::strip::paint_left(
            frame.buffer_mut(),
            Rect::new(area.x, area.y + index as u16, area.width, 1),
            line.clone(),
        );
    }
    paint_hits(
        frame,
        app,
        area,
        0,
        usize::from(area.height),
        &mapped.mentions,
        Paint {
            reader: false,
            role,
            transcript: None,
        },
    );
    true
}

/// Decorate a fitted plain row while resolving only its complete original text.
/// Truncation cannot turn an unknown/longer name into another member's link.
pub(super) fn paint_plain_hits(
    frame: &mut Frame,
    app: &App,
    area: Rect,
    source: &str,
    displayed: &str,
    reader: bool,
) {
    let (resolved, urls) = app
        .member_links
        .borrow_mut()
        .plain(source, app.look(), &app.references);
    let mut links = Vec::new();
    for (occurrence, link) in resolved.iter().enumerate() {
        let source_column = unicode_width::UnicodeWidthStr::width(&source[..link.range.start]);
        if source_column >= usize::from(area.width) {
            break;
        }
        // Anchor the complete source prefix, not just the name: an earlier
        // unknown name or its clipped prefix cannot borrow this occurrence.
        if let Some(start) = displayed.find(&source[..link.range.end]) {
            links.push(Link {
                column: unicode_width::UnicodeWidthStr::width(&displayed[..start]) + source_column,
                width: unicode_width::UnicodeWidthStr::width(&source[link.range.clone()]),
                target: Target::Member(link.identity.clone()),
                occurrence,
                source: None,
            });
        }
    }
    // A bare web link opens its complete source address; when the row is cut, only its
    // painted part is the hit.
    for (index, range) in urls.iter().enumerate() {
        let before = &source[..range.start];
        let Some(start) = displayed.find(before) else {
            continue;
        };
        let url = &source[range.clone()];
        let shown = displayed[start + before.len()..]
            .char_indices()
            .zip(url.chars())
            .take_while(|((_, painted), wanted)| painted == wanted)
            .last()
            .map_or(0, |((at, painted), _)| at + painted.len_utf8());
        let column = unicode_width::UnicodeWidthStr::width(&displayed[..start + before.len()]);
        if shown == 0 || column >= usize::from(area.width) {
            continue;
        }
        let tail = &displayed[start + before.len()..];
        links.push(Link {
            column,
            width: unicode_width::UnicodeWidthStr::width(&tail[..shown]),
            target: Target::Url(url.to_owned()),
            occurrence: resolved.len() + index,
            source: None,
        });
    }
    paint_hits(
        frame,
        app,
        area,
        0,
        1,
        &[links],
        Paint {
            reader,
            role: tmt_cli_style::Role::Text,
            transcript: None,
        },
    );
}

impl App {
    pub(super) fn member_link_hint(&self) -> Option<&'static str> {
        let state = self.member_links.borrow();
        if self.input.is_some() {
            return None;
        }
        if self.focus == 0 {
            return state
                .focused
                .as_ref()
                .filter(|hit| !hit.reader && self.row_name_hits().contains(hit))
                .map(|_| "←→ name  ⏎ menu  Esc back");
        }
        state
            .hits
            .iter()
            .any(|hit| hit.reader)
            .then_some("←→ mentions · Enter actions · Tab panes · Esc back")
    }
}

#[cfg(test)]
pub(super) fn capture_menu(app: &mut App) {
    let hit = app
        .member_links
        .borrow()
        .hits
        .iter()
        .find(|hit| hit.reader)
        .cloned();
    if let Some(hit) = hit {
        app.open_member_link(hit);
    }
}

pub(in crate::board) mod popover;
#[cfg(test)]
pub(in crate::board) mod tests;
