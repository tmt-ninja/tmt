//! Structured block projections retain original source-line identities.
use super::*;

impl Renderer<'_> {
    pub(super) fn code_block(&mut self, range: std::ops::Range<usize>) {
        let raw = &self.source[range.clone()];
        let style = self
            .look
            .role(Role::Code)
            .patch(self.look.role(Role::Track));
        let mut painted = false;
        for (event, at) in Parser::new(raw).into_offset_iter() {
            let Event::Text(body) = event else { continue };
            let first = self
                .starts
                .partition_point(|start| *start <= range.start + at.start)
                .saturating_sub(1);
            for (offset, line) in body
                .strip_suffix('\n')
                .unwrap_or(&body)
                .split('\n')
                .enumerate()
            {
                let text = crate::board::view::fit(line, self.width);
                let line_start = self.starts[first + offset];
                let mut part = Part::new(text, style, first + offset, None);
                let mut padding = String::new();
                if let Some(reference) = self.commands.get(self.next_command)
                    && reference.console
                    && reference.content.start == line_start
                    && reference.content.end <= range.end
                {
                    // The literal row fills the pane, but only the visible prompt is a link.
                    padding = part.text.split_off(part.text.trim_end_matches(' ').len());
                    part.style = part.style.add_modifier(Modifier::UNDERLINED);
                    part.member = Some((
                        super::super::member_links::Target::Command(reference.command.clone()),
                        self.next_mention,
                    ));
                    if reference.command.shown.starts_with(&part.text) {
                        part.source_range = Some(
                            reference.content.start..reference.content.start + part.text.len(),
                        );
                    }
                    self.next_mention += 1;
                    self.next_command += 1;
                }
                let mut spans = vec![part];
                if !padding.is_empty() {
                    spans.push(Part::new(padding, style, first + offset, None));
                }
                self.blocks.push(Block {
                    prefix: String::new(),
                    indent: 0,
                    spans,
                    source_line: first + offset,
                    literal: true,
                    style,
                    prefix_style: Style::new(),
                    quote_depth: 0,
                });
                painted = true;
            }
        }
        if !painted {
            self.blocks.push(Block {
                prefix: String::new(),
                indent: 0,
                spans: vec![Part::new(
                    " ".repeat(self.width),
                    style,
                    self.source_line,
                    None,
                )],
                source_line: self.source_line,
                literal: true,
                style,
                prefix_style: Style::new(),
                quote_depth: 0,
            });
        }
        self.skip_until = range.end;
    }
}
