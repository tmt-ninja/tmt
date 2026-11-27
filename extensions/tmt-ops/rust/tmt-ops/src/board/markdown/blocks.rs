//! Structured block projections retain original source-line identities.
use super::super::member_links::{Origin, Target, commands::Command};
use super::*;
use unicode_width::UnicodeWidthStr;

const CONTINUATION: &str = "↪";

impl Renderer<'_> {
    pub(super) fn code_block(&mut self, range: std::ops::Range<usize>, kind: CodeBlockKind<'_>) {
        self.skip_until = range.end;
        if self.preserve_breaks
            && let CodeBlockKind::Fenced(info) = kind
        {
            let language = super::super::notes::single_line(&info);
            let language = language
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .to_owned();
            let command = self
                .commands
                .get(self.next_command)
                .filter(|reference| !reference.console && reference.range.start == range.start)
                .filter(|reference| tmt_pty_protocol::valid_command(&reference.command.text))
                .map(|reference| reference.command.text.clone());
            self.fences.push((
                self.blocks.len(),
                Fence {
                    language,
                    range: range.clone(),
                    body: None,
                    command,
                },
            ));
        }
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
                    Some((&reference.command, occurrence, offset == 0)),
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
                    (command, occurrence, true)
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
        link: Option<(&Command, usize, bool)>,
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
        let (line, start) = match link {
            Some((command, _, true)) if command.shown.lines().next() == Some(line) => {
                let text = command.text.split('\n').next().unwrap_or_default();
                if let Some(prefix) = line.strip_suffix(text) {
                    (text, start.map(|at| at + prefix.len()))
                } else {
                    (line, start)
                }
            }
            _ => (line, start),
        };
        let mut used = 0;
        loop {
            let rest = &line[used..];
            let span = Span::raw(rest);
            let mut glyphs = span.styled_graphemes(Style::new()).peekable();
            let first = glyphs.peek().map_or(0, |glyph| glyph.symbol.width());
            let marker = used > 0 && first < self.width;
            let chip = link.is_some() && !rest.trim().is_empty();
            let chip_prefix = if link.is_some_and(|(_, _, first)| first) && chip && used == 0 {
                match self.width {
                    1 => "",
                    2..=3 => "▶",
                    _ => " ▶ ",
                }
            } else {
                ""
            };
            let chip_suffix =
                usize::from(chip && self.width > chip_prefix.width() + usize::from(marker) + 1);
            let room = self.width - usize::from(marker) - chip_prefix.width() - chip_suffix;
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
            let fragment_start = shown_start + chip_prefix.len();
            let code_origin = start.map(|start| Origin {
                source: start + used..start + used + bytes,
                shown: fragment_start..fragment_start + fragment.len(),
            });
            let mut part = Part::new(fragment.into(), style, source_line, None);
            if let Some((command, occurrence, _)) = link
                && chip
            {
                part.text = format!("{chip_prefix}{fragment}{}", " ".repeat(chip_suffix));
                part.member = Some((Target::Command(command.clone()), occurrence));
                part.style = self.look.selection();
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

/// The parser gives the exact source offsets of code text even when it strips container
/// prefixes or represents CRLF as a separate LF event. Work from those offsets, never the
/// normalized event text. A top-level fence keeps even the indentation hidden by Markdown.
fn source_bodies(source: &str) -> Vec<(std::ops::Range<usize>, String)> {
    let mut bodies = Vec::new();
    let mut fence = None;
    let mut containers = 0;
    for (event, span) in Parser::new_ext(source, MESSAGE_OPTIONS).into_offset_iter() {
        match event {
            Event::Start(Tag::BlockQuote(_) | Tag::Item) => containers += 1,
            Event::End(TagEnd::BlockQuote(_) | TagEnd::Item) => containers -= 1,
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(_))) => {
                let start = source[span.clone()]
                    .find('\n')
                    .map(|offset| span.start + offset + 1);
                fence = Some((span, start, start, String::new()));
            }
            Event::Text(_) => {
                if let Some((_, _, end, body)) = &mut fence {
                    let mut start = span.start;
                    if source.as_bytes().get(start) == Some(&b'\n')
                        && start > 0
                        && source.as_bytes()[start - 1] == b'\r'
                    {
                        start -= 1;
                    }
                    *end = Some(span.end);
                    if containers > 0 {
                        body.push_str(&source[start..span.end]);
                    }
                }
            }
            Event::End(TagEnd::CodeBlock) => {
                if let Some((span, start, end, mut body)) = fence.take() {
                    if containers == 0
                        && let Some((start, end)) = start.zip(end)
                    {
                        body.push_str(&source[start..end]);
                    }
                    bodies.push((span, body));
                }
            }
            _ => {}
        }
    }
    bodies
}

pub(super) fn recover_bodies(fences: &mut [(usize, Fence)], source: &str, clean: &str) {
    let originals = source_bodies(source);
    let display = if source == clean {
        originals
            .iter()
            .map(|(span, _)| span.clone())
            .collect::<Vec<_>>()
    } else {
        let projected = source_bodies(clean);
        if projected.len() != originals.len()
            || originals
                .iter()
                .zip(&projected)
                .any(|((_, raw), (_, shown))| {
                    super::super::notes::sanitize(raw) != super::super::notes::sanitize(shown)
                })
        {
            return;
        }
        projected.into_iter().map(|(span, _)| span).collect()
    };
    let mut bodies = display.into_iter().zip(originals).peekable();
    for (_, fence) in fences {
        while bodies
            .peek()
            .is_some_and(|(range, _)| range.start < fence.range.start)
        {
            bodies.next();
        }
        if let Some((_, (_, body))) = bodies.next_if(|(range, _)| range == &fence.range) {
            fence.body = Some(body);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fences_preserve_source_payload_and_line_identity_across_wraps() {
        for (source, payload, language, first) in [
            (
                "```rust\n  a long code line  \n\n  b\n```\n",
                "  a long code line  \n\n  b\n",
                "rust",
                1,
            ),
            ("  ```\r\n   x  \r\n  ```\r\n", "   x  \r\n", "", 1),
            ("> ```text\n> x  \n>   y\n> ```\n", "x  \n  y\n", "text", 1),
            ("~~~\n  x", "  x", "", 1),
        ] {
            for width in [5, 80] {
                let mapped =
                    render_conversation(source, width, crate::look::Look::default(), None, None);
                let [(row, fence)] = &mapped.fences[..] else {
                    panic!("one strip for {source:?}")
                };
                assert_eq!(fence.body.as_deref(), Some(payload), "{source:?}");
                assert_eq!(fence.language, language);
                assert_eq!(mapped.sources[*row], first);
                assert_eq!(mapped.lines.len(), mapped.sources.len());
            }
        }
    }
}
