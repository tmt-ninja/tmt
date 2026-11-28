//! Read-only Markdown over sanitized held text, with source-line and member
//! identities retained through wrapping. Code, quotes and fitted table grids are
//! presentation only; unsupported HTML/images/footnotes remain literal. Nothing
//! executes, fetches or turns an untrusted destination into an action.

mod blocks;
mod files;
mod inline;
mod tables;

use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use ratatui::{
    style::{Modifier, Style},
    text::{Line, Span},
};
use tmt_cli_style::Role;
use unicode_width::UnicodeWidthChar;

// Exact reported messages are fixture data: retain the original Chinese wording
// and screenshot path so rendering and source-copy regressions use the same input.
#[cfg(test)]
pub(in crate::board) mod reported {
    pub(in crate::board) const QUOTE: &str = r###"> "1. STATE 欄是不是拿掉「Needs you」？"
拿掉，這沒啥用
> "2. 標題列要不要顯示總數（○ N todo）？"
要
> "3. 是不是只算指派給你的待辦？"
任何只要在清單的都算"###;
    pub(in crate::board) const PATH: &str = r###"奇怪為什麼我剛才送給你的訊息在tui chat render出來長這樣 '/var/folders/dd/bs0t1qsx01q5tv2ft5jftw500000gn/T/TemporaryItems/NSIRD_screencaptureui_WKlpZN/Screenshot 2026-10-24 at 10.41.26.png' "###;
}

/// One logical line before wrapping: a first-line prefix, the indent for
/// wrapped continuation lines, and styled text.
struct Block {
    prefix: String,
    indent: usize,
    spans: Vec<Part>,
    source_line: usize,
    literal: bool,
    code_origin: Option<super::member_links::Origin>,
    style: Style,
    prefix_style: Style,
    quote_depth: usize,
}

/// Styled source text with an optional resolved UUID and occurrence identity.
struct Part {
    text: String,
    style: Style,
    source: usize,
    member: Option<(super::member_links::Target, usize)>,
    source_range: Option<std::ops::Range<usize>>,
}
impl Part {
    fn new(
        text: String,
        style: Style,
        source: usize,
        member: Option<(super::member_links::Target, usize)>,
    ) -> Self {
        Self {
            text,
            style,
            source,
            member,
            source_range: None,
        }
    }

    /// One source reference laid out as a whole caption.
    fn is_atomic(&self) -> bool {
        matches!(
            &self.member,
            Some((
                super::member_links::Target::File(_)
                    | super::member_links::Target::Command(_)
                    | super::member_links::Target::Work(_),
                _
            ))
        )
    }

    fn width(&self) -> usize {
        if self.is_atomic() {
            unicode_width::UnicodeWidthStr::width(self.text.as_str())
        } else {
            cells(&self.text)
        }
    }
}

#[derive(Clone)]
struct SourceReference {
    range: std::ops::Range<usize>,
    target: super::member_links::Target,
    label: String,
}

struct Renderer<'a> {
    preserve_breaks: bool,
    inventory: Option<&'a super::inventory::Inventory>,
    next_mention: usize,
    source: &'a str,
    starts: Vec<usize>,
    source_line: usize,
    look: crate::look::Look,
    blocks: Vec<Block>,
    fences: Vec<(usize, Fence)>,
    current: Option<Block>,
    bold: usize,
    italic: usize,
    heading: bool,
    link: bool,
    /// The address of the link being read, and the occurrence its cells share, when the
    /// board may open it.
    link_url: Option<(String, usize)>,
    quote_depth: usize,
    width: usize,
    /// Numbering for each open list; None for bullets.
    lists: Vec<Option<u64>>,
    /// Skip events inside an unsupported construct already shown as source.
    skip_until: usize,
    /// The table whose rows are being read.
    table: Option<tables::Build>,
    references: Vec<SourceReference>,
    next_reference: usize,
    commands: Vec<super::member_links::commands::Reference>,
    next_command: usize,
}

impl Renderer<'_> {
    fn style(&self) -> Style {
        let mut style = if self.quote_depth > 0 {
            self.look.role(Role::Muted)
        } else {
            self.look.role(Role::Text)
        };
        if self.heading {
            style = style
                .patch(self.look.role(Role::Accent))
                .add_modifier(Modifier::BOLD);
        } else if self.bold > 0 {
            style = style.add_modifier(Modifier::BOLD);
        }
        if self.italic > 0 {
            style = style.add_modifier(Modifier::ITALIC);
        }
        if self.link {
            style = style
                .patch(self.look.role(Role::Accent))
                .add_modifier(Modifier::UNDERLINED);
        }
        style
    }

    fn start(&mut self, mut prefix: String, mut indent: usize) {
        self.finish();
        if self.quote_depth > 0 {
            prefix = "▎ ".repeat(self.quote_depth) + &prefix;
            indent += self.quote_depth * 2;
        }
        self.current = Some(Block {
            prefix,
            indent,
            spans: Vec::new(),
            source_line: self.source_line,
            literal: false,
            code_origin: None,
            style: Style::new(),
            quote_depth: self.quote_depth,
            prefix_style: self.look.role(if self.quote_depth > 0 {
                Role::Dim
            } else {
                Role::Accent
            }),
        });
    }

    /// Text that opens `url` from the board, in its own occurrence.
    fn push_url(&mut self, text: &str, style: Style, url: &str) {
        if self.current.is_none() {
            let indent = self.lists.len() * 2;
            self.start(" ".repeat(indent), indent);
        }
        let occurrence = self.next_mention;
        self.next_mention += 1;
        if let Some(block) = &mut self.current {
            block.spans.push(Part::new(
                text.into(),
                style,
                self.source_line,
                Some((super::member_links::Target::Url(url.into()), occurrence)),
            ));
        }
    }

    fn push_reference(&mut self, reference: SourceReference) {
        if self.current.is_none() {
            let indent = self.lists.len() * 2;
            self.start(" ".repeat(indent), indent);
        }
        let style = if matches!(reference.target, super::member_links::Target::File(_)) {
            self.style()
                .patch(self.look.role(Role::Code))
                .patch(self.look.role(Role::Track))
        } else {
            self.style()
        };
        let mut part = Part::new(
            reference.label,
            style,
            self.source_line,
            Some((reference.target, self.next_mention)),
        );
        if part.is_atomic() {
            part.source_range = Some(reference.range);
        }
        self.next_mention += 1;
        self.current
            .as_mut()
            .expect("a block is open")
            .spans
            .push(part);
    }

    fn line_of(&self, at: usize) -> usize {
        self.starts
            .partition_point(|start| *start <= at)
            .saturating_sub(1)
    }

    fn text(&mut self, text: &str, range: std::ops::Range<usize>) {
        while self.next_reference < self.references.len()
            && self.references[self.next_reference].range.end <= range.start
        {
            self.next_reference += 1;
        }
        if self.next_reference == self.references.len()
            || self.references[self.next_reference].range.start >= range.end
        {
            self.prose(text);
            return;
        }
        let mut at = range.start;
        while self.next_reference < self.references.len()
            && self.references[self.next_reference].range.start < range.end
        {
            let start = self.references[self.next_reference].range.start;
            let end = self.references[self.next_reference].range.end;
            if at < start {
                self.prose(&self.source[at..start]);
            }
            if start >= range.start {
                self.push_reference(self.references[self.next_reference].clone());
            }
            at = at.max(end);
            if end > range.end {
                break;
            }
            self.next_reference += 1;
        }
        if at < range.end {
            self.prose(&self.source[at..range.end]);
        }
    }

    /// The block a line break opens starts on the source line after the break.
    fn continue_on_next_source_line(&mut self) {
        let next = self.source_line + 1;
        if let Some(block) = &mut self.current {
            block.source_line = next;
        }
    }

    fn finish(&mut self) {
        if let Some(block) = self.current.take() {
            self.blocks.push(block);
        }
    }

    fn push(&mut self, text: &str, style: Style) {
        if self.current.is_none() {
            let indent = self.lists.len() * 2;
            self.start(" ".repeat(indent), indent);
        }
        if let Some(block) = &mut self.current {
            if let Some((url, occurrence)) = &self.link_url {
                block.spans.push(Part::new(
                    text.into(),
                    style,
                    self.source_line,
                    Some((super::member_links::Target::Url(url.clone()), *occurrence)),
                ));
                return;
            }
            let mut at = 0;
            for mention in self.inventory.map_or_else(Vec::new, |inventory| {
                super::member_links::resolve(text, inventory)
            }) {
                if mention.range.start > at {
                    block.spans.push(Part::new(
                        text[at..mention.range.start].into(),
                        style,
                        self.source_line,
                        None,
                    ));
                }
                block.spans.push(Part::new(
                    mention.name,
                    style
                        .patch(self.look.role(Role::Text))
                        .remove_modifier(Modifier::BOLD)
                        .add_modifier(Modifier::UNDERLINED),
                    self.source_line,
                    Some((
                        super::member_links::Target::Member(mention.identity),
                        self.next_mention,
                    )),
                ));
                self.next_mention += 1;
                at = mention.range.end;
            }
            if at < text.len() || text.is_empty() {
                block
                    .spans
                    .push(Part::new(text[at..].into(), style, self.source_line, None));
            }
        }
    }

    /// Blank line between top-level blocks, never before the first.
    fn separate(&mut self) {
        self.finish();
        if self.lists.is_empty() && !self.blocks.is_empty() {
            self.blocks.push(Block {
                prefix: String::new(),
                indent: 0,
                spans: Vec::new(),
                source_line: self.source_line.saturating_sub(1),
                literal: false,
                code_origin: None,
                style: Style::new(),
                prefix_style: Style::new(),
                quote_depth: 0,
            });
        }
    }

    /// Shows a construct exactly as written, one block per source line.
    fn source(&mut self, range: std::ops::Range<usize>) {
        self.finish();
        let raw = self.source[range.clone()].trim_end_matches('\n');
        for (offset, line) in raw.split('\n').enumerate() {
            self.current = Some(Block {
                prefix: String::new(),
                indent: 0,
                spans: Vec::new(),
                source_line: self.source_line + offset,
                literal: false,
                code_origin: None,
                style: Style::new(),
                prefix_style: Style::new(),
                quote_depth: 0,
            });
            let source_line = self.source_line;
            self.source_line += offset;
            self.push(line, Style::new());
            self.finish();
            self.source_line = source_line;
        }
        self.skip_until = range.end;
    }

    fn event(&mut self, event: Event<'_>, range: std::ops::Range<usize>) {
        if range.start < self.skip_until {
            return;
        }
        self.source_line = self
            .starts
            .partition_point(|start| *start <= range.start)
            .saturating_sub(1);
        if files::inline(&event) {
            let index = self
                .references
                .partition_point(|reference| reference.range.start <= range.start);
            if index > 0 && range.end <= self.references[index - 1].range.end {
                return;
            }
        }
        if self.table_event(&event, &range) {
            return;
        }
        while self.next_command < self.commands.len()
            && self.commands[self.next_command].range.end <= range.start
        {
            self.next_command += 1;
        }
        if self.next_command < self.commands.len()
            && matches!(event, Event::Code(_))
            && self.commands[self.next_command].range.start == range.start
        {
            let reference = self.commands[self.next_command].clone();
            let occurrence = self.next_mention;
            self.next_mention += 1;
            let source_line = self.line_of(reference.content.start);
            if self.current.is_none() {
                self.start(String::new(), 0);
            }
            let mut part = Part::new(
                format!(" ▶ {} ", reference.command.text),
                self.look.selection(),
                source_line,
                Some((
                    super::member_links::Target::Command(reference.command),
                    occurrence,
                )),
            );
            part.source_range = Some(reference.content);
            self.current
                .as_mut()
                .expect("an inline command has a line")
                .spans
                .push(part);
            self.skip_until = reference.range.end;
            self.next_command += 1;
            return;
        }
        match event {
            Event::Start(
                Tag::HtmlBlock
                | Tag::FootnoteDefinition(_)
                | Tag::MetadataBlock(_)
                | Tag::DefinitionList,
            ) => {
                self.separate();
                self.source(range);
            }
            Event::Start(Tag::Table(_)) => {
                self.separate();
                self.table_start(range);
            }
            Event::Start(Tag::CodeBlock(kind)) => {
                self.separate();
                self.code_block(range, kind);
            }
            Event::Start(Tag::BlockQuote(_)) => {
                self.separate();
                self.quote_depth += 1;
            }
            Event::End(TagEnd::BlockQuote(_)) => {
                self.finish();
                self.quote_depth = self.quote_depth.saturating_sub(1);
            }
            Event::Start(Tag::Image { .. }) => {
                let text = self.source[range.clone()].to_owned();
                self.push(&text, Style::new());
                self.skip_until = range.end;
            }
            Event::Start(Tag::Heading { .. }) => {
                self.separate();
                self.heading = true;
                self.start(String::new(), 0);
            }
            Event::End(TagEnd::Heading(_)) => {
                self.heading = false;
                self.finish();
            }
            Event::Start(Tag::Paragraph) => {
                if self.current.is_none() {
                    self.separate();
                }
            }
            Event::End(TagEnd::Paragraph) => {
                if self.lists.is_empty() {
                    self.finish();
                }
            }
            Event::Start(Tag::List(start)) => {
                if self.lists.is_empty() {
                    self.separate();
                } else {
                    self.finish();
                }
                self.lists.push(start);
            }
            Event::End(TagEnd::List(_)) => {
                self.finish();
                self.lists.pop();
            }
            Event::Start(Tag::Item) => {
                let depth = self.lists.len().saturating_sub(1);
                let marker = match self.lists.last_mut() {
                    Some(Some(number)) => {
                        let marker = format!("{number}. ");
                        *number += 1;
                        marker
                    }
                    _ => "• ".to_owned(),
                };
                let indent = depth * 2 + marker.chars().count();
                self.start(format!("{}{marker}", " ".repeat(depth * 2)), indent);
            }
            Event::End(TagEnd::Item) => self.finish(),
            Event::Start(Tag::Strong) => self.bold += 1,
            Event::End(TagEnd::Strong) => self.bold = self.bold.saturating_sub(1),
            Event::Start(Tag::Emphasis) => self.italic += 1,
            Event::End(TagEnd::Emphasis) => self.italic = self.italic.saturating_sub(1),
            Event::Start(Tag::Link { dest_url, .. }) => {
                self.link = crate::links::styled_target(&dest_url);
                self.link_url = crate::effects::openable(&dest_url)
                    .is_ok()
                    .then(|| (dest_url.to_string(), self.next_mention));
                self.next_mention += usize::from(self.link_url.is_some());
            }
            Event::End(TagEnd::Link) => {
                self.link = false;
                self.link_url = None;
            }
            Event::Text(text) => {
                self.text(&text, range);
            }
            Event::Code(code) => self.push(
                &code,
                self.style()
                    .patch(self.look.role(Role::Code))
                    .patch(self.look.role(Role::Track)),
            ),
            Event::SoftBreak if !self.preserve_breaks => self.push(" ", self.style()),
            Event::SoftBreak | Event::HardBreak => {
                let indent = self
                    .current
                    .as_ref()
                    .map_or(0, |block| block.indent)
                    .saturating_sub(self.quote_depth * 2);
                self.start(" ".repeat(indent), indent);
                self.continue_on_next_source_line();
            }
            Event::Rule => {
                self.separate();
                self.blocks.push(Block {
                    prefix: String::new(),
                    indent: 0,
                    spans: vec![Part::new(
                        "───".into(),
                        self.look.role(Role::Dim),
                        self.source_line,
                        None,
                    )],
                    source_line: self.source_line,
                    literal: false,
                    code_origin: None,
                    style: Style::new(),
                    prefix_style: Style::new(),
                    quote_depth: 0,
                });
            }
            // Inline HTML, footnote references and anything else: as written.
            Event::Html(text) | Event::InlineHtml(text) => self.push(&text, Style::new()),
            _ => {
                let text = self.source[range].to_owned();
                self.push(&text, Style::new());
            }
        }
    }
}

/// Renders sanitized notes as styled lines wrapped to `width` display cells.
pub fn render(text: &str, width: usize, look: crate::look::Look) -> Vec<Line<'static>> {
    render_mapped(text, width, look).lines
}

/// Painted response lines and their zero-based source lines. No parsed link
/// destination or activation target crosses this display boundary.
pub(super) struct Fence {
    pub language: String,
    range: std::ops::Range<usize>,
    pub body: Option<String>,
    pub command: Option<String>,
}

pub(super) struct Mapped {
    pub lines: Vec<Line<'static>>,
    pub sources: Vec<usize>,
    pub mentions: Vec<Vec<super::member_links::Link>>,
    pub code_origins: Vec<(usize, super::member_links::Origin)>,
    pub fences: Vec<(usize, Fence)>,
}

pub(super) fn render_mapped(text: &str, width: usize, look: crate::look::Look) -> Mapped {
    render_with_members(text, width, look, None)
}

pub(super) fn render_with_members<'a>(
    text: &'a str,
    width: usize,
    look: crate::look::Look,
    inventory: Option<&'a super::inventory::Inventory>,
) -> Mapped {
    project(text, width, look, inventory, Format::Markdown, false, None)
}
/// Conversation messages keep authored single newlines without rewriting source bytes.
pub(super) fn render_conversation_with_members<'a>(
    text: &'a str,
    width: usize,
    look: crate::look::Look,
    inventory: Option<&'a super::inventory::Inventory>,
) -> Mapped {
    render_conversation(text, width, look, inventory, None)
}

pub(super) fn render_conversation(
    text: &str,
    width: usize,
    look: crate::look::Look,
    inventory: Option<&super::inventory::Inventory>,
    work: Option<&super::work_references::References>,
) -> Mapped {
    // Display normalization must never silently rewrite a command that can be submitted.
    let clean = super::notes::sanitize(text);
    let mut mapped = project(
        &clean,
        width,
        look,
        inventory,
        Format::Message,
        clean == text,
        work,
    );
    if !mapped.fences.is_empty() {
        blocks::recover_bodies(&mut mapped.fences, text, &clean);
    }
    mapped
}
pub(super) fn render_plain_with_members<'a>(
    text: &'a str,
    width: usize,
    look: crate::look::Look,
    inventory: &'a super::inventory::Inventory,
) -> Mapped {
    project(
        text,
        width,
        look,
        Some(inventory),
        Format::Plain,
        false,
        None,
    )
}

/// Discover captions in source order, without reading a list during Markdown layout.
fn checklist_references(text: &str) -> Vec<SourceReference> {
    let mut references = Vec::new();
    let mut base = 0;
    for line in text.split_inclusive('\n') {
        let mut title_start = 0;
        let mut chunk_start = 0;
        for chunk in line.split_inclusive(')') {
            let end = chunk_start + chunk.len();
            if let Some((title, id)) = chunk
                .strip_suffix(')')
                .and_then(|part| part.rsplit_once(" ("))
                && (4..=36).contains(&id.len())
                && id.bytes().enumerate().all(|(index, byte)| {
                    if matches!(index, 8 | 13 | 18 | 23) {
                        byte == b'-'
                    } else {
                        byte.is_ascii_hexdigit()
                    }
                })
            {
                let title_end = chunk_start + title.len();
                let words = &line[title_start..title_end];
                // A separate hashtag earlier in the same sentence is not part of the caption.
                if let Some((start, _)) = words.rmatch_indices('#').find(|&(index, _)| {
                    words[..index].chars().next_back().is_none_or(|ch| {
                        ch.is_whitespace() || matches!(ch, '(' | '[' | '{' | '\'' | '"')
                    }) && words[index + 1..].starts_with(|ch: char| !ch.is_whitespace())
                }) {
                    let start = title_start + start;
                    references.push(SourceReference {
                        range: base + start..base + end,
                        label: line[start..end].to_owned(),
                        target: super::member_links::Target::Checklist(id.to_ascii_lowercase()),
                    });
                }
                title_start = end;
            }
            chunk_start = end;
        }
        base += line.len();
    }
    references
}

struct WorkMatch<'a> {
    range: std::ops::Range<usize>,
    reference: &'a super::work_references::Reference,
}

fn work_references<'a>(
    text: &str,
    work: &'a super::work_references::References,
) -> Vec<WorkMatch<'a>> {
    let mut covered = 0;
    text.match_indices('#')
        .filter_map(|(start, _)| {
            if start < covered
                || text[..start].chars().next_back().is_some_and(|ch| {
                    ch.is_alphanumeric() || matches!(ch, '#' | '_' | '-' | '/' | '\\')
                })
            {
                return None;
            }
            let suffix = &text[start + 1..];
            let length = suffix
                .bytes()
                .take_while(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
                .count();
            let reference = work.get(&suffix[..length])?;
            let end = start + 1 + length;
            // A locally sent body already has this caption. Its source range
            // belongs to the link as well, so the title is painted only once.
            covered = text[end..]
                .strip_prefix(" (")
                .and_then(|tail| tail.strip_prefix(&reference.title))
                .filter(|tail| tail.starts_with(')'))
                .map_or(end, |_| end + reference.title.len() + 3);
            Some(WorkMatch {
                range: start..covered,
                reference,
            })
        })
        .collect()
}

/// Attach titles to Talk references, without rewriting quoted or literal source.
pub(super) fn expand_work_references(
    text: String,
    work: &super::work_references::References,
    limit: usize,
) -> Option<String> {
    if text.len() > limit {
        return None;
    }
    let mut references = work_references(&text, work);
    if references.is_empty() {
        return Some(text);
    }
    let events: Vec<_> = Parser::new_ext(&text, MESSAGE_OPTIONS)
        .into_offset_iter()
        .collect();
    files::retain_prose(&mut references, |reference| &reference.range, &events);
    let mut inert: Vec<_> = events
        .into_iter()
        .filter_map(|(event, range)| {
            matches!(event, Event::Start(Tag::BlockQuote(_))).then_some(range)
        })
        .collect();
    inert.extend(
        checklist_references(&text)
            .into_iter()
            .map(|reference| reference.range),
    );
    inert.extend(
        files::scan(&text)
            .into_iter()
            .map(|reference| reference.range),
    );
    inert.sort_unstable_by_key(|range| range.start);
    let (mut next, mut end) = (0, 0);
    references.retain(|reference| {
        while next < inert.len() && inert[next].start < reference.range.end {
            end = end.max(inert[next].end);
            next += 1;
        }
        end <= reference.range.start
    });
    let mut length = text.len();
    for found in &references {
        length = length - found.range.len()
            + found.reference.number.len()
            + found.reference.title.len()
            + 4;
        if length > limit {
            return None;
        }
    }
    let mut expanded = String::with_capacity(length);
    let mut at = 0;
    for found in references {
        expanded.push_str(&text[at..found.range.start]);
        expanded.push('#');
        expanded.push_str(&found.reference.number);
        expanded.push_str(" (");
        expanded.push_str(&found.reference.title);
        expanded.push(')');
        at = found.range.end;
    }
    expanded.push_str(&text[at..]);
    Some(expanded)
}

const MESSAGE_OPTIONS: Options = Options::ENABLE_TABLES.union(Options::ENABLE_FOOTNOTES);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    Markdown,
    Message,
    Plain,
}

fn project<'a>(
    text: &'a str,
    width: usize,
    look: crate::look::Look,
    inventory: Option<&'a super::inventory::Inventory>,
    format: Format,
    commands_unchanged: bool,
    work: Option<&super::work_references::References>,
) -> Mapped {
    let options = MESSAGE_OPTIONS;
    let mut references = Vec::new();
    if format == Format::Message {
        references.extend(files::scan(text).into_iter().map(|file| SourceReference {
            label: file.label(),
            range: file.range,
            target: super::member_links::Target::File(file.path),
        }));
        references.extend(checklist_references(text));
        if let Some(work) = work {
            references.extend(work_references(text, work).into_iter().map(|found| {
                let reference = found.reference;
                SourceReference {
                    range: found.range,
                    label: format!("#{} {}", reference.number, reference.title),
                    target: super::member_links::Target::Work(reference.number.clone()),
                }
            }));
        }
        // Earlier references own overlapping bytes. At an equal start keep the
        // longer reference, which includes the complete checklist caption.
        references.sort_by_key(|reference| {
            (
                reference.range.start,
                std::cmp::Reverse(reference.range.end),
            )
        });
        let mut end = 0;
        references.retain(|reference| {
            if reference.range.start < end {
                return false;
            }
            end = reference.range.end;
            true
        });
    }
    // Source offsets protect an inline reference even when Markdown fragments its text.
    let events: Option<Vec<_>> = (!references.is_empty())
        .then(|| Parser::new_ext(text, options).into_offset_iter().collect());
    if let Some(events) = &events {
        files::retain_prose(&mut references, |reference| &reference.range, events);
    }
    let starts = std::iter::once(0)
        .chain(text.match_indices('\n').map(|(at, _)| at + 1))
        .collect();
    let mut renderer = Renderer {
        preserve_breaks: format != Format::Markdown,
        inventory,
        next_mention: 0,
        source: text,
        starts,
        source_line: 0,
        look,
        blocks: Vec::new(),
        fences: Vec::new(),
        current: None,
        bold: 0,
        italic: 0,
        heading: false,
        link: false,
        link_url: None,
        quote_depth: 0,
        width: width.max(1),
        lists: Vec::new(),
        skip_until: 0,
        table: None,
        references,
        next_reference: 0,
        commands: if commands_unchanged {
            super::member_links::commands::scan(text)
        } else {
            Vec::new()
        },
        next_command: 0,
    };
    if format == Format::Plain {
        for (source, line) in text.split('\n').enumerate() {
            renderer.source_line = source;
            renderer.push(line, look.role(Role::Text));
            renderer.finish();
        }
    } else if let Some(events) = events {
        for (event, range) in events {
            renderer.event(event, range);
        }
    } else {
        for (event, range) in Parser::new_ext(text, options).into_offset_iter() {
            renderer.event(event, range);
        }
    }
    renderer.finish();
    let mut mapped = Mapped {
        lines: Vec::new(),
        sources: Vec::new(),
        mentions: Vec::new(),
        code_origins: Vec::new(),
        fences: Vec::new(),
    };
    let mut fences = renderer.fences.into_iter().peekable();
    for (index, block) in renderer.blocks.into_iter().enumerate() {
        if let Some((_, fence)) = fences.next_if(|(block, _)| *block == index) {
            mapped.fences.push((mapped.lines.len(), fence));
        }
        let code_origin = block.code_origin.clone();
        for (line, source, mentions) in wrap(block, width.max(1)) {
            if let Some(origin) = &code_origin {
                mapped
                    .code_origins
                    .push((mapped.lines.len(), origin.clone()));
            }
            mapped.lines.push(line);
            mapped.sources.push(source);
            mapped.mentions.push(mentions);
        }
    }
    mapped
}

fn cells(text: &str) -> usize {
    text.chars().map(|c| c.width().unwrap_or(0)).sum()
}

/// Wrap application-authored spans with the same cell and word rules as Markdown.
/// Literal status text carries no member links or parsed markup.
pub(super) fn wrap_styled(line: Line<'static>, width: usize) -> Vec<Line<'static>> {
    let style = line.style;
    wrap(
        Block {
            prefix: String::new(),
            indent: 0,
            spans: line
                .spans
                .into_iter()
                .map(|span| Part::new(span.content.into_owned(), style.patch(span.style), 0, None))
                .collect(),
            source_line: 0,
            literal: false,
            code_origin: None,
            style: Style::new(),
            prefix_style: Style::new(),
            quote_depth: 0,
        },
        width.max(1),
    )
    .into_iter()
    .map(|(line, _, _)| line)
    .collect()
}

/// Greedy word wrap over styled spans; continuation lines use the hanging
/// indent, and a word longer than a line is split between characters.
fn wrap(block: Block, width: usize) -> Vec<(Line<'static>, usize, Vec<super::member_links::Link>)> {
    if block.literal {
        let mut spans = Vec::new();
        let mut mentions = Vec::new();
        let mut column = 0;
        for part in block.spans {
            let width = part.width();
            let shown = spans
                .iter()
                .map(|span: &Span<'_>| span.content.len())
                .sum::<usize>();
            let source = part
                .source_range
                .clone()
                .map(|source| super::member_links::Origin {
                    source,
                    shown: shown..shown + part.text.len(),
                });
            if let Some((target, occurrence)) = part.member {
                mentions.push(super::member_links::Link {
                    column: if source.is_some() {
                        spans.iter().map(Span::width).sum()
                    } else {
                        column
                    },
                    width,
                    target,
                    occurrence,
                    source,
                });
            }
            column += width;
            spans.push(Span::styled(part.text, part.style));
        }
        return vec![(
            Line::from(spans).style(block.style),
            block.source_line,
            mentions,
        )];
    }
    if cells(&block.prefix) >= width {
        let text = block.prefix.clone()
            + &block
                .spans
                .iter()
                .map(|part| part.text.as_str())
                .collect::<String>();
        return vec![(
            Line::styled(crate::board::view::fit(&text, width), block.prefix_style),
            block.source_line,
            Vec::new(),
        )];
    }
    let mut lines = Vec::new();
    let mut mentions = Vec::new();
    let mut line: Vec<Span<'static>> = vec![Span::styled(block.prefix.clone(), block.prefix_style)];
    let mut used = cells(&block.prefix);
    let start = used;
    let mut source_line = block.source_line;
    let indent = "▎ ".repeat(block.quote_depth)
        + &" ".repeat(block.indent.saturating_sub(block.quote_depth * 2));
    let mut words = Vec::new();
    for part in block.spans {
        if part.is_atomic() {
            words.push(part);
            continue;
        }
        let Part {
            text,
            style,
            source,
            member: identity,
            ..
        } = part;
        for word in text.split_inclusive(' ') {
            words.push(Part::new(word.to_owned(), style, source, identity.clone()));
        }
    }
    for part in words {
        if part.is_atomic() {
            let caption = files::fit(&part.text, width.saturating_sub(block.indent).max(1));
            used = line.iter().map(Span::width).sum();
            let caption_width = unicode_width::UnicodeWidthStr::width(caption.as_str());
            if used > start && used + caption_width > width {
                lines.push((
                    Line::from(std::mem::take(&mut line)),
                    source_line,
                    std::mem::take(&mut mentions),
                ));
                source_line = part.source;
                line.push(Span::styled(indent.clone(), block.prefix_style));
                used = block.indent;
            }
            let shown = line.iter().map(|span| span.content.len()).sum::<usize>();
            if let Some((target, occurrence)) = part.member {
                mentions.push(super::member_links::Link {
                    column: used,
                    width: caption_width,
                    target,
                    occurrence,
                    source: part.source_range.map(|source| super::member_links::Origin {
                        source,
                        shown: shown..shown + caption.len(),
                    }),
                });
            }
            line.push(Span::styled(caption, part.style));
            used += caption_width;
            continue;
        }
        let Part {
            text: word,
            style,
            source,
            member: identity,
            ..
        } = part;
        let body = word.trim_end_matches(' ');
        if used > start && used + cells(body) > width {
            if let Some(space) = line.last_mut().filter(|span| span.content == " ") {
                space.style = space.style.remove_modifier(Modifier::UNDERLINED);
            }
            lines.push((
                Line::from(std::mem::take(&mut line)),
                source_line,
                std::mem::take(&mut mentions),
            ));
            source_line = source;
            line.push(Span::styled(indent.clone(), block.prefix_style));
            used = block.indent;
        }
        let mut piece = String::new();
        for character in body.chars() {
            let character = if character.width().unwrap_or(0) > width.saturating_sub(block.indent) {
                '…'
            } else {
                character
            };
            let size = character.width().unwrap_or(0);
            if used + size > width {
                line.push(Span::styled(std::mem::take(&mut piece), style));
                lines.push((
                    Line::from(std::mem::take(&mut line)),
                    source_line,
                    std::mem::take(&mut mentions),
                ));
                source_line = source;
                line.push(Span::styled(indent.clone(), block.prefix_style));
                used = block.indent;
            }
            if let Some((target, occurrence)) = &identity {
                if let Some(last) =
                    mentions
                        .last_mut()
                        .filter(|last: &&mut super::member_links::Link| {
                            last.target == *target
                                && last.occurrence == *occurrence
                                && last.column + last.width == used
                        })
                {
                    last.width += size;
                } else {
                    mentions.push(super::member_links::Link {
                        column: used,
                        width: size,
                        target: target.clone(),
                        occurrence: *occurrence,
                        source: None,
                    });
                }
            }
            piece.push(character);
            used += size;
        }
        line.push(Span::styled(piece, style));
        if word.ends_with(' ') && used < width {
            if let Some((target, occurrence)) = &identity {
                mentions.push(super::member_links::Link {
                    column: used,
                    width: 1,
                    target: target.clone(),
                    occurrence: *occurrence,
                    source: None,
                });
            }
            line.push(Span::styled(" ", style));
            used += 1;
        }
    }
    lines.push((Line::from(line), source_line, mentions));
    lines
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::look::Look;

    #[test]
    fn command_chip_hits_include_padding_while_urls_keep_their_underline() {
        use super::super::member_links::Target;
        use tmt_cli_style::theme::Depth;
        use unicode_width::UnicodeWidthStr;

        let source = "Run `！ pwd` and read [docs](https://example.test).";
        let chip = " ▶ pwd ";
        for depth in [Depth::TrueColor, Depth::None] {
            let look = Look {
                depth,
                ..Look::default()
            };
            let mapped = render_conversation_with_members(source, 80, look, None);
            let span = mapped.lines[0]
                .spans
                .iter()
                .find(|span| span.content == chip)
                .expect("painted command chip");
            assert_eq!(span.style, look.selection());
            if depth == Depth::None {
                assert!(span.style.add_modifier.contains(Modifier::REVERSED));
            }
            assert!(mapped.lines[0].spans.iter().any(|span| {
                span.content.contains("docs")
                    && span.style.add_modifier.contains(Modifier::UNDERLINED)
            }));
            let hit = mapped.mentions[0]
                .iter()
                .find(|hit| matches!(&hit.target, Target::Command(_)))
                .expect("command target");
            assert_eq!(hit.column, "Run ".width());
            assert_eq!(hit.width, chip.width());
            assert!(matches!(&hit.target, Target::Command(command) if command.text == "pwd"));
        }
    }

    #[test]
    fn command_captions_keep_exact_content_ranges_and_fence_body_line_numbers() {
        use super::super::member_links::Target;
        let source = "Header\n\n```sh\n! printf first\nprintf second\n```";
        let mapped = render_conversation_with_members(source, 80, Look::default(), None);
        let commands: Vec<_> = mapped
            .mentions
            .iter()
            .enumerate()
            .flat_map(|(row, links)| {
                links
                    .iter()
                    .filter(|link| matches!(link.target, Target::Command(_)))
                    .map(move |link| (row, link))
            })
            .collect();
        assert_eq!(commands.len(), 2);
        for ((row, link), (line, text)) in commands
            .into_iter()
            .zip([(3, "printf first"), (4, "printf second")])
        {
            assert_eq!(mapped.sources[row], line);
            assert_eq!(&source[link.source.as_ref().unwrap().source.clone()], text);
        }
    }

    #[test]
    fn fenced_code_wraps_with_filled_continuations_and_source_lines() {
        let look = Look::default();
        let mapped = render_mapped("```rust\n  abcdefghijk\n界界界界界\n```", 8, look);
        assert_eq!(
            text(&mapped.lines),
            ["  abcdef", "↪ghijk", "界界界界", "↪界"]
        );
        assert_eq!(mapped.sources, [1, 1, 2, 2]);
        for line in &mapped.lines {
            assert_eq!(line.width(), 8, "the fill covers the whole block row");
            assert_eq!(line.style.bg, look.role(Role::Track).bg);
        }
        assert_eq!(mapped.lines[1].spans[0].style.fg, look.role(Role::Dim).fg);

        for (width, expected) in [(1, vec!["a", "�", "b"]), (2, vec!["a", "界", "↪b"])] {
            let narrow = render_mapped("```\na界b\n```", width, look);
            assert_eq!(text(&narrow.lines), expected);
            assert_eq!(narrow.sources, [1, 1, 1]);
            assert!(narrow.lines.iter().all(|line| line.width() == width));
        }
    }

    #[test]
    fn wrapped_console_and_marked_fence_links_keep_the_whole_command() {
        use super::super::member_links::Target;
        for (language, prefix) in [("console", "$ "), ("text", "！ ")] {
            let command = "printf abcdefghijk";
            let shown = format!("{prefix}{command}");
            let source = format!("```{language}\n{shown}\n```");
            let mapped = render_conversation_with_members(&source, 8, Look::default(), None);
            let mut fragments = String::new();
            assert!(mapped.lines.len() > 1);
            for (row, links) in mapped.mentions.iter().enumerate() {
                let [link] = links.as_slice() else {
                    panic!("expected one command hit on each code row: {links:?}");
                };
                let Target::Command(target) = &link.target else {
                    panic!()
                };
                assert_eq!(target.text, command);
                assert_eq!(link.occurrence, 0);
                assert_eq!(link.column, usize::from(row != 0));
                assert!(link.column + link.width <= 8);
                assert_eq!(mapped.sources[row], 1);
                fragments.push_str(&source[link.source.as_ref().unwrap().source.clone()]);
            }
            assert_eq!(fragments, command);
        }
    }

    #[test]
    fn quotes_use_a_muted_body_and_a_dim_gutter_without_source_markers() {
        let look = Look::default();
        let mapped = render_mapped("> first **bold**", 30, look);
        assert_eq!(text(&mapped.lines), ["▎ first bold"]);
        let gutter = &mapped.lines[0].spans[0];
        assert_eq!(gutter.content, "▎ ");
        assert_eq!(gutter.style.fg, look.role(Role::Dim).fg);
        assert_eq!(
            style_of(&mapped.lines, "first").fg,
            look.role(Role::Muted).fg
        );
        assert!(
            style_of(&mapped.lines, "bold")
                .add_modifier
                .contains(Modifier::BOLD)
        );
    }

    #[test]
    fn reported_quote_soft_breaks_keep_one_gutter_without_accumulating_indent() {
        for width in [160, 100, 80, 60, 40, 24] {
            let mapped =
                render_conversation_with_members(reported::QUOTE, width, Look::default(), None);
            let rows = text(&mapped.lines);
            for (index, row) in rows.iter().enumerate() {
                let body = row
                    .strip_prefix("▎ ")
                    .unwrap_or_else(|| panic!("{width}/{index}: {row:?}"));
                assert!(
                    !body.starts_with(' '),
                    "{width}/{index}: accumulated indent in {row:?}"
                );
                assert!(
                    mapped.lines[index].width() <= width,
                    "{width}/{index}: {row:?}"
                );
                assert!(mapped.sources[index] < 6);
            }
            if width == 160 {
                assert_eq!(
                    rows,
                    [
                        r#"▎ "1. STATE 欄是不是拿掉「Needs you」？""#,
                        "▎ 拿掉，這沒啥用",
                        r#"▎ "2. 標題列要不要顯示總數（○ N todo）？""#,
                        "▎ 要",
                        r#"▎ "3. 是不是只算指派給你的待辦？""#,
                        "▎ 任何只要在清單的都算",
                    ]
                );
                assert_eq!(mapped.sources, [0, 1, 2, 3, 4, 5]);
            }
        }
    }

    #[test]
    fn nested_quote_list_soft_and_hard_breaks_share_the_same_hanging_indent() {
        let soft = "> > - first line with several words
> >   second line with several words
> >   third line with several words";
        let hard = soft.replace('\n', "  \n");
        for width in [80, 24, 12] {
            let a = render_conversation_with_members(soft, width, Look::default(), None);
            let b = render_conversation_with_members(&hard, width, Look::default(), None);
            assert_eq!(
                a.lines, b.lines,
                "soft and hard quote continuations at {width}"
            );
            assert_eq!(a.sources, b.sources);
            assert!(a.lines.iter().all(|line| line.width() <= width));
        }
    }

    #[test]
    fn message_file_paths_are_basename_chips_without_changing_other_prose() {
        for (source, shown) in [
            ("/tmp/report_name.txt", "⧉ report_name.txt"),
            (
                "see '/tmp/my report_name.txt' now",
                "see ⧉ my report_name.txt now",
            ),
            ("\"/tmp/一個 檔案.txt\"", "⧉ 一個 檔案.txt"),
        ] {
            let mapped = render_conversation_with_members(source, 200, Look::default(), None);
            assert_eq!(text(&mapped.lines), [shown], "{source:?}");
            assert!(mapped.sources.iter().all(|line| *line == 0));
        }
    }

    #[test]
    fn file_chips_keep_surrounding_punctuation_and_slash_commands_as_prose() {
        use super::super::member_links::Target;
        let source = "/compact /review /help See (/tmp/report_name.txt), next.";
        let mapped = render_conversation_with_members(source, 200, Look::default(), None);
        assert_eq!(
            text(&mapped.lines),
            ["/compact /review /help See (⧉ report_name.txt), next."]
        );
        let references: Vec<_> = mapped.mentions.iter().flatten().collect();
        assert_eq!(references.len(), 1);
        assert_eq!(
            references[0].target,
            Target::File("/tmp/report_name.txt".into())
        );
        let origin = references[0].source.as_ref().unwrap();
        assert_eq!(&source[origin.source.clone()], "/tmp/report_name.txt");
    }

    #[test]
    fn a_link_glued_to_cjk_prose_is_a_link_and_the_prose_stays_text() {
        use super::super::member_links::Target;
        // Ben's 11-05 case: no space before the address, a full-width colon joins it.
        let source = "Night 頁連結：http://127.0.0.1:50711/colab/p/36b98efb";
        let mapped = render_conversation_with_members(source, 200, Look::default(), None);
        assert_eq!(text(&mapped.lines), [source]);
        let references: Vec<_> = mapped.mentions.iter().flatten().collect();
        assert_eq!(references.len(), 1);
        assert_eq!(
            references[0].target,
            Target::Url("http://127.0.0.1:50711/colab/p/36b98efb".into())
        );
        // A web link after CJK text ends before full-width punctuation.
        let source = "請看https://example.com/a。下一步";
        let mapped = render_conversation_with_members(source, 200, Look::default(), None);
        assert_eq!(text(&mapped.lines), [source]);
        let references: Vec<_> = mapped.mentions.iter().flatten().collect();
        assert_eq!(references.len(), 1);
        assert_eq!(
            references[0].target,
            Target::Url("https://example.com/a".into())
        );
        // After an ASCII letter it is one word, not a link.
        let mapped = render_conversation_with_members("xhttp://x.dev", 200, Look::default(), None);
        assert!(mapped.mentions.iter().flatten().next().is_none());
    }

    #[test]
    fn a_file_chip_fits_one_line_and_ellipsizes_instead_of_wrapping() {
        let source = "'/tmp/very_long_file_name_with_spaces_in_it.txt'";
        for width in [1, 2, 3, 4, 12, 24] {
            let mapped = render_conversation_with_members(source, width, Look::default(), None);
            assert_eq!(
                mapped.lines.len(),
                1,
                "width={width}: {:?}",
                text(&mapped.lines)
            );
            assert!(mapped.lines[0].width() <= width);
            assert!(mapped.lines[0].to_string().ends_with('…'));
            assert_eq!(mapped.sources, [0]);
        }
        assert_eq!(
            text(&render_conversation_with_members(source, 100, Look::default(), None).lines),
            ["⧉ very_long_file_name_with_spaces_in_it.txt"]
        );
    }

    #[test]
    fn file_chips_exclude_code_urls_relative_paths_and_prose_word_substrings() {
        for source in [
            "`/tmp/my_file.txt`",
            "```\n/tmp/my_file.txt\n```",
            "https://example.com/tmp/my_file.txt",
            "file:///tmp/my_file.txt",
            "prefix/tmp/my_file.txt",
            "src/my_file.txt",
            "'relative path/my_file.txt'",
        ] {
            let mapped = render_conversation_with_members(source, 200, Look::default(), None);
            assert!(
                !mapped
                    .lines
                    .iter()
                    .any(|line| line.to_string().contains('⧉')),
                "{source:?}"
            );
        }
    }

    #[test]
    fn file_tokens_keep_inline_syntax_literal_but_do_not_leak_style_into_prose() {
        use super::super::member_links::Target;
        let source = "before &amp; '/tmp/a&amp;_b*bold*.txt' after";
        let mapped = render_conversation_with_members(source, 200, Look::default(), None);
        assert_eq!(text(&mapped.lines), ["before & ⧉ a&amp;_b*bold*.txt after"]);
        let links: Vec<_> = mapped.mentions.iter().flatten().collect();
        assert_eq!(links.len(), 1);
        assert_eq!(
            links[0].target,
            Target::File("/tmp/a&amp;_b*bold*.txt".into())
        );
        let origin = links[0].source.as_ref().unwrap();
        assert_eq!(&source[origin.source.clone()], "'/tmp/a&amp;_b*bold*.txt'");
        assert!(
            !style_of(&mapped.lines, "after")
                .add_modifier
                .contains(Modifier::BOLD)
        );
        let mapped = render_conversation_with_members(
            "**before '/tmp/my_file.txt' after** plain",
            200,
            Look::default(),
            None,
        );
        assert!(
            style_of(&mapped.lines, "after")
                .add_modifier
                .contains(Modifier::BOLD)
        );
        assert!(
            !style_of(&mapped.lines, "plain")
                .add_modifier
                .contains(Modifier::BOLD)
        );
        for source in [
            "`'/tmp/file with space.txt'`",
            "[label '/tmp/file with space.txt'](https://example.com)",
        ] {
            let mapped = render_conversation_with_members(source, 200, Look::default(), None);
            assert!(
                !mapped
                    .mentions
                    .iter()
                    .flatten()
                    .any(|link| matches!(link.target, Target::File(_)))
            );
        }
    }

    #[test]
    fn repeated_unicode_chips_keep_distinct_targets_and_fit_quote_list_and_table_rows() {
        use super::super::member_links::Target;
        for source in [
            "> '/tmp/👩‍💻_one.txt' /other/one.txt",
            "- '/tmp/👩‍💻_one.txt' /other/one.txt",
            "| name |\n| --- |\n| '/tmp/👩‍💻_one.txt' /other/one.txt |",
        ] {
            for width in [12, 24, 80] {
                let mapped = render_conversation_with_members(source, width, Look::default(), None);
                assert!(
                    mapped.lines.iter().all(|line| line.width() <= width),
                    "{source}: {width}"
                );
                let links: Vec<_> = mapped
                    .mentions
                    .iter()
                    .flatten()
                    .filter(|link| matches!(link.target, Target::File(_)))
                    .collect();
                assert_eq!(links.len(), 2, "{source}: {width}");
                assert_ne!(links[0].occurrence, links[1].occurrence);
                for (row, links) in mapped.mentions.iter().enumerate() {
                    for link in links {
                        assert!(link.column + link.width <= mapped.lines[row].width());
                        assert!(link.source.is_some());
                    }
                }
            }
        }
    }

    #[test]
    fn many_inline_fragments_in_one_filename_keep_one_atomic_reference() {
        use super::super::member_links::Target;
        // Lexical references do not stat a path: even a long synthetic filename
        // must keep its source bytes while its many Markdown events are consumed.
        let path = format!("/tmp/{}.txt", "a*b*".repeat(512));
        let token = format!("'{path}'");
        let source = format!("before {token} after");
        let mapped = render_conversation_with_members(&source, 80, Look::default(), None);
        let links: Vec<_> = mapped.mentions.iter().flatten().collect();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, Target::File(path));
        assert_eq!(
            &source[links[0].source.as_ref().unwrap().source.clone()],
            token
        );
        assert_eq!(
            mapped
                .lines
                .iter()
                .map(ToString::to_string)
                .collect::<String>()
                .matches('⧉')
                .count(),
            1
        );
        assert!(
            !style_of(&mapped.lines, "after")
                .add_modifier
                .contains(Modifier::ITALIC)
        );
    }

    #[test]
    fn file_tokens_do_not_cross_code_or_link_boundaries() {
        use super::super::member_links::Target;
        for source in [
            "before '/tmp/a`b.txt' after` tail",
            "before '/tmp/a[b.txt' after](https://example.com) tail",
        ] {
            let mapped = render_conversation_with_members(source, 80, Look::default(), None);
            assert!(
                !mapped
                    .mentions
                    .iter()
                    .flatten()
                    .any(|link| matches!(link.target, Target::File(_))),
                "{source}"
            );
        }
    }

    #[test]
    fn reported_and_bare_paths_keep_underscores_spaces_and_source_mapping() {
        for (source, label) in [
            (reported::PATH, "⧉ Screenshot 2026-10-24 at 10.41.26.png"),
            ("/tmp/some_dir/file_name.rs", "⧉ file_name.rs"),
            (
                "src/some_module/file_name.rs",
                "src/some_module/file_name.rs",
            ),
        ] {
            for width in [512, 160, 100, 80, 60, 24] {
                let mapped = render_conversation_with_members(source, width, Look::default(), None);
                let rows = text(&mapped.lines);
                assert!(mapped.lines.iter().all(|line| line.width() <= width));
                assert!(mapped.sources.iter().all(|source| *source == 0));
                assert!(
                    mapped
                        .lines
                        .iter()
                        .flat_map(|line| &line.spans)
                        .all(|span| !span.style.add_modifier.contains(Modifier::ITALIC))
                );
                let links: Vec<_> = mapped.mentions.iter().flatten().collect();
                if source.starts_with("src/") {
                    assert!(links.is_empty(), "relative paths stay literal");
                } else {
                    assert_eq!(links.len(), 1, "{source}: {width}");
                    let super::super::member_links::Target::File(path) = &links[0].target else {
                        panic!("file reference lost its path");
                    };
                    let range = &links[0].source.as_ref().unwrap().source;
                    assert!(source[range.clone()].contains(path));
                }
                if width == 512 {
                    let expected = if source == reported::PATH {
                        format!("{}{}", source.split('\'').next().unwrap(), label)
                    } else {
                        label.to_owned()
                    };
                    assert_eq!(rows, [expected]);
                }
            }
        }
    }

    #[test]
    fn headings_links_quote_bars_and_code_carry_their_own_roles() {
        let look = Look::default();
        let mapped = render_mapped(
            "# Title\n\n[site](https://x.dev) and `inline`\n\n- [ ] item\n\n> quoted\n\n```\nblock\n```",
            40,
            look,
        );
        let title = style_of(&mapped.lines, "Title");
        assert_eq!(title.fg, look.role(Role::Accent).fg);
        assert!(title.add_modifier.contains(Modifier::BOLD));
        let link = style_of(&mapped.lines, "site");
        assert_eq!(link.fg, look.role(Role::Accent).fg);
        assert!(link.add_modifier.contains(Modifier::UNDERLINED));
        let inline = style_of(&mapped.lines, "inline");
        assert_eq!(inline.fg, look.role(Role::Code).fg);
        assert_eq!(inline.bg, look.role(Role::Track).bg);
        let block = style_of(&mapped.lines, "block");
        assert_eq!(block.fg, look.role(Role::Code).fg);
        assert_eq!(block.bg, look.role(Role::Track).bg);
        // A quote keeps the dim bar; an ordinary list or prefix is Accent only outside a quote.
        let quote_bar = mapped
            .lines
            .iter()
            .flat_map(|line| line.spans.iter())
            .find(|span| span.content.starts_with('▎'))
            .expect("quote bar");
        assert_eq!(quote_bar.style.fg, look.role(Role::Dim).fg);
    }

    #[test]
    fn wrapped_quote_rows_keep_the_gutter_inside_the_width() {
        let lines = render("> wide words that wrap", 10, Look::default());
        assert!(lines.len() > 1);
        for line in lines {
            assert!(line.to_string().starts_with("▎ "));
            assert!(line.width() <= 10);
        }
    }

    #[test]
    fn a_table_wider_than_the_pane_squeezes_its_widest_column_and_wraps_the_cell() {
        let source = "| a | b |\n|---|---|\n| aaaa bbbb | c |";
        let mapped = render_mapped(source, 12, Look::default());
        assert_eq!(
            text(&mapped.lines),
            [
                "┌──────┬───┐",
                "│ a    │ b │",
                "├──────┼───┤",
                "│ aaaa │ c │",
                "│ bbbb │   │",
                "└──────┴───┘"
            ]
        );
        assert_eq!(mapped.sources, [0, 0, 0, 2, 2, 2]);
    }

    #[test]
    fn tables_in_quotes_and_lists_keep_their_context_inside_the_width() {
        let source = "> | Name | Notes |\n> |---|---|\n> | one | words that need to wrap here |\n\n- item\n\n  | Name | Notes |\n  |---|---|\n  | one | words that need to wrap here |";
        for width in [24, 40, 80] {
            let mapped = render_mapped(source, width, Look::default());
            let lines = text(&mapped.lines);
            let quoted: Vec<_> = lines.iter().filter(|line| line.starts_with('▎')).collect();
            assert!(quoted.len() >= 5, "{width}: {lines:?}");
            assert!(quoted.iter().all(|line| line.starts_with("▎ ")));
            assert!(
                lines.iter().any(|line| line.starts_with("  ┌")),
                "{width}: {lines:?}"
            );
            assert!(lines.iter().all(|line| !line.contains("|--")), "{width}");
            for line in &mapped.lines {
                assert!(line.width() <= width, "{width}: {line:?}");
            }
        }
    }

    #[test]
    fn tables_have_a_boxed_header_grid_and_fall_back_when_the_grid_cannot_fit() {
        let source = "| a | b |\n|---|---|\n| 1 | 2 |";
        let look = Look::default();
        let wide = render_mapped(source, 9, look);
        assert_eq!(
            text(&wide.lines),
            [
                "┌───┬───┐",
                "│ a │ b │",
                "├───┼───┤",
                "│ 1 │ 2 │",
                "└───┴───┘"
            ]
        );
        assert!(
            style_of(&wide.lines, "a")
                .add_modifier
                .contains(Modifier::BOLD)
        );
        assert_eq!(wide.sources, [0, 0, 0, 2, 2]);
        let narrow_mapped = render_mapped(source, 8, look);
        assert!(
            narrow_mapped
                .sources
                .iter()
                .all(|line| *line < source.lines().count())
        );
        let narrow = text(&narrow_mapped.lines).join(" ");
        assert!(!narrow.contains('┌'));
        assert!(narrow.contains('|') && narrow.contains("---"));
    }

    #[test]
    fn structured_blocks_stay_inside_tiny_and_unicode_widths() {
        for source in [
            "> > 界界界 wide text",
            "1. 界界界 wide text",
            "```\n界界界\n```",
            "| 界 | b |\n|---|---|\n| x | |",
        ] {
            for width in 0..=24 {
                let mapped = render_mapped(source, width, Look::default());
                assert_eq!(mapped.lines.len(), mapped.sources.len());
                for line in mapped.lines {
                    assert!(line.width() <= width.max(1), "width={width}: {line:?}");
                }
            }
        }
    }

    #[test]
    fn mapped_render_keeps_source_lines_through_wrapping_and_unsupported_blocks() {
        let source = "# Title\n\n- wide words that wrap\n- next\n\n```\ncode\n```";
        let mapped = render_mapped(source, 12, Look::default());
        assert_eq!(mapped.lines, render(source, 12, Look::default()));
        assert_eq!(mapped.lines.len(), mapped.sources.len());
        assert_eq!(mapped.sources[0], 0);
        assert_eq!(
            mapped.sources[1], 1,
            "separator is not the following list item"
        );
        assert!(mapped.sources.iter().filter(|source| **source == 2).count() > 1);
        let code = text(&mapped.lines)
            .iter()
            .position(|line| line == "code")
            .unwrap();
        assert_eq!(mapped.sources[code], 6);
        assert!(
            mapped
                .sources
                .iter()
                .all(|line| *line < source.split('\n').count())
        );
        let linked = render_mapped("[alpha\nbeta](https://example.com)", 9, Look::default());
        assert!(
            linked.sources.windows(2).all(|pair| pair[0] <= pair[1]),
            "multiline link labels preserve source order"
        );
    }

    #[test]
    fn link_styles_follow_unicode_wrap_and_undefined_schemes_stay_plain() {
        let mapped = render_mapped(
            "- [界 **wide** `code`](tmt:jump/auth-fix) [evil](javascript:x) #412",
            10,
            Look::default(),
        );
        assert!(!text(&mapped.lines).join(" ").contains("tmt:jump"));
        let underlined = |span: &Span| span.style.add_modifier.contains(Modifier::UNDERLINED);
        let first = &mapped.lines[0];
        assert_eq!(first.spans[2].content, " ");
        assert!(underlined(&first.spans[2]), "inner space joins the label");
        assert!(!underlined(first.spans.last().unwrap()));
        for line in &mapped.lines {
            assert!(line.width() <= 10);
        }
        assert!(mapped.sources.iter().all(|source| *source == 0));
        assert!(
            mapped
                .lines
                .iter()
                .flat_map(|line| &line.spans)
                .any(|span| span.content.contains("界") && underlined(span))
        );
        let plain = render_mapped("[evil](javascript:x)", 80, Look::default());
        assert!(
            plain
                .lines
                .iter()
                .flat_map(|line| &line.spans)
                .all(|span| !underlined(span))
        );
    }

    fn text(lines: &[Line]) -> Vec<String> {
        lines
            .iter()
            .map(|line| {
                line.spans
                    .iter()
                    .map(|span| span.content.as_ref())
                    .collect::<String>()
            })
            .map(|line| line.trim_end().to_owned())
            .collect()
    }

    fn style_of(lines: &[Line], needle: &str) -> Style {
        lines
            .iter()
            .flat_map(|line| line.spans.iter())
            .find(|span| span.content.contains(needle))
            .map(|span| span.style)
            .unwrap_or_else(|| panic!("{needle} not rendered"))
    }

    #[test]
    fn the_supported_subset_is_styled_and_nested_lists_indent() {
        let notes = "## Now\n\n- tokens: **waiting** on Ben\n  - *login* vs `sweep`\n- see [PR 412](https://x/412)\n\n1. first\n2. second\n";
        let lines = render(notes, 60, Look::default());
        assert_eq!(
            text(&lines),
            [
                "Now",
                "",
                "• tokens: waiting on Ben",
                "  • login vs sweep",
                "• see PR 412",
                "",
                "1. first",
                "2. second",
            ]
        );
        assert!(
            style_of(&lines, "Now")
                .add_modifier
                .contains(Modifier::BOLD)
        );
        assert!(
            style_of(&lines, "waiting")
                .add_modifier
                .contains(Modifier::BOLD)
        );
        assert!(
            style_of(&lines, "login")
                .add_modifier
                .contains(Modifier::ITALIC)
        );
        assert_eq!(
            style_of(&lines, "sweep").fg,
            Look::default().role(Role::Code).fg
        );
        assert!(
            style_of(&lines, "412")
                .add_modifier
                .contains(Modifier::UNDERLINED)
        );
    }

    #[test]
    fn unsupported_html_images_and_footnotes_remain_literal_beside_supported_blocks() {
        let notes = "| a | b |\n|---|---|\n| 1 | 2 |\n\n<div>raw html</div>\n\n```sh\ntmt x\n```\n\n> quoted\n\nsee ![diagram](d.png) and <b>bold</b>[^1]\n\n[^1]: footnote\n";
        let rendered = text(&render(notes, 80, Look::default()));
        for expected in ["<div>raw html</div>", "tmt x", "▎ quoted", "[^1]: footnote"] {
            assert!(
                rendered.iter().any(|line| line == expected),
                "{expected}: {rendered:#?}"
            );
        }
        assert!(rendered.iter().any(|line| line.starts_with("┌")));
        assert!(!rendered.iter().any(|line| line.starts_with("```")));
        let inline = rendered
            .iter()
            .find(|line| line.starts_with("see "))
            .unwrap();
        assert!(inline.contains("![diagram](d.png)") && inline.contains("<b>bold</b>"));
        assert!(inline.contains("[^1]"), "{inline}");
    }

    #[test]
    fn wrapping_respects_width_hanging_indent_and_wide_characters() {
        let notes = "- 安装指南 consolidates the install guide into one page with platform tabs\n";
        let lines = render(notes, 20, Look::default());
        for line in &lines {
            let width: usize = line.spans.iter().map(|span| cells(&span.content)).sum();
            assert!(width <= 20, "{line:?}");
        }
        let rendered = text(&lines);
        assert!(rendered[0].starts_with("• 安装指南"));
        assert!(
            rendered[1..].iter().all(|line| line.starts_with("  ")),
            "{rendered:#?}"
        );
        let long = text(&render(&"x".repeat(45), 20, Look::default()));
        assert_eq!(long, ["x".repeat(20), "x".repeat(20), "x".repeat(5)]);
    }

    #[test]
    fn hostile_notes_render_without_any_control_or_format_character() {
        let hostile =
            "# \u{1b}]0;PWNED\u{7}Title\n\n- \u{1b}[2J**bold**\u{202e}rev\n\n`\u{9b}31mcode`";
        let lines = render(&crate::board::notes::sanitize(hostile), 40, Look::default());
        let all: String = lines
            .iter()
            .flat_map(|line| line.spans.iter().map(|span| span.content.to_string()))
            .collect();
        assert!(
            !all.chars()
                .any(|c| c.is_control() || ('\u{202a}'..='\u{202e}').contains(&c)),
            "{all:?}"
        );
        assert!(
            all.contains("Title")
                && all.contains("bold")
                && all.contains("rev")
                && all.contains("code")
        );
    }
}
