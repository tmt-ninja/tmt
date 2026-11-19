//! Structured block projections retain original source-line identities.
use super::super::member_links::{Origin, Target, commands::Command};
use super::*;
use unicode_width::UnicodeWidthStr;

const CONTINUATION: &str = "↪";

impl Renderer<'_> {
    pub(super) fn code_block(&mut self, range: std::ops::Range<usize>) {
        self.skip_until = range.end;
        let style = self
            .look
            .role(Role::Code)
            .patch(self.look.role(Role::Track));
        if let Some(reference) = self.commands.get(self.next_command)
            && !reference.console
            && reference.range.start == range.start
        {
            // The fence is one action, with an exact addressed fragment on each row.
            let reference = reference.clone();
            let occurrence = self.next_mention;
            self.next_mention += 1;
            self.next_command += 1;
            let first = self.line_of(reference.content.start);
            let mut start = reference.content.start;
            for (offset, line) in reference.command.shown.split('\n').enumerate() {
                self.code_line(
                    line,
                    first + offset,
                    Some(start),
                    style,
                    Some((&reference.command, occurrence)),
                );
                start += line.len() + 1;
            }
            return;
        }

        let raw = &self.source[range.clone()];
        let mut painted = false;
        for (event, at) in Parser::new(raw).into_offset_iter() {
            let Event::Text(body) = event else { continue };
            let first = self.line_of(range.start + at.start);
            for (offset, line) in body
                .strip_suffix('\n')
                .unwrap_or(&body)
                .split('\n')
                .enumerate()
            {
                let index = first + offset;
                let line_start = self.starts[index];
                let line_end = self
                    .starts
                    .get(index + 1)
                    .copied()
                    .unwrap_or(self.source.len());
                let original = self.source[line_start..line_end].trim_end_matches(['\r', '\n']);
                // The parser may omit fence indentation from the painted line.
                let start = original
                    .strip_suffix(line)
                    .map(|prefix| line_start + prefix.len());
                let command = self
                    .commands
                    .get(self.next_command)
                    .filter(|reference| {
                        reference.console
                            && reference.content.start == line_start
                            && reference.content.end <= range.end
                    })
                    .map(|reference| reference.command.clone());
                let link = command.as_ref().map(|command| {
                    let occurrence = self.next_mention;
                    self.next_mention += 1;
                    self.next_command += 1;
                    (command, occurrence)
                });
                self.code_line(line, index, start, style, link);
                painted = true;
            }
        }
        if !painted {
            self.code_line("", self.source_line, None, style, None);
        }
    }

    fn code_line(
        &mut self,
        line: &str,
        source_line: usize,
        start: Option<usize>,
        style: Style,
        link: Option<(&Command, usize)>,
    ) {
        // The conversation already sanitizes its source. Keep non-conversation
        // uses inert as well, and omit exact offsets if that changes the bytes.
        let clean;
        let (line, start) = if line.contains(char::is_control) {
            clean = super::super::notes::sanitize(line);
            (clean.as_str(), None)
        } else {
            (line, start)
        };
        let mut used = 0;
        loop {
            let rest = &line[used..];
            let span = Span::raw(rest);
            let mut glyphs = span.styled_graphemes(Style::new()).peekable();
            let first = glyphs.peek().map_or(0, |glyph| glyph.symbol.width());
            let marker = used > 0 && first < self.width;
            let room = self.width - usize::from(marker);
            let mut width = 0;
            let mut bytes = 0;
            let fallback = first > room;
            if fallback {
                bytes = glyphs.next().unwrap().symbol.len();
                width = 1;
            } else {
                for glyph in glyphs {
                    let size = glyph.symbol.width();
                    if width + size > room {
                        break;
                    }
                    width += size;
                    bytes += glyph.symbol.len();
                }
            }
            let fragment = if fallback { "�" } else { &rest[..bytes] };
            let mut spans = Vec::with_capacity(3);
            let shown_start = if marker {
                spans.push(Part::new(
                    CONTINUATION.into(),
                    style.patch(self.look.role(Role::Dim)),
                    source_line,
                    None,
                ));
                CONTINUATION.len()
            } else {
                0
            };
            let mut part = Part::new(fragment.into(), style, source_line, None);
            let code_origin = start.map(|start| Origin {
                source: start + used..start + used + bytes,
                shown: shown_start..shown_start + fragment.len(),
            });
            if let Some((command, occurrence)) = link
                && !fragment.trim().is_empty()
            {
                part.member = Some((Target::Command(command.clone()), occurrence));
                part.style = style.add_modifier(Modifier::UNDERLINED);
                if let Some(origin) = &code_origin {
                    part.source_range = Some(origin.source.clone());
                }
            }
            spans.push(part);
            if width < room {
                spans.push(Part::new(
                    " ".repeat(room - width),
                    style,
                    source_line,
                    None,
                ));
            }
            self.blocks.push(Block {
                prefix: String::new(),
                indent: 0,
                spans,
                source_line,
                literal: true,
                code_origin,
                style,
                prefix_style: Style::new(),
                quote_depth: 0,
            });
            used += bytes;
            if used >= line.len() {
                break;
            }
        }
    }
}
