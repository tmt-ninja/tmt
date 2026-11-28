//! One presentation of acquired recipient counts and optional context usage.
use super::*;
use crate::board::{inventory::ContextUsage, unread::Count};
use ratatui::text::Span;
use tmt_cli_style::theme::screen::{self, ChipKind, ChipState};

pub(in crate::board) struct Info<'a> {
    pub name: &'a str,
    pub focused: bool,
    pub shell: bool,
    pub checklist: bool,
    pub keep_reply: bool,
    pub keep_reply_key: Option<String>,
    pub unread: Option<Count>,
    pub context: Option<ContextUsage>,
}
/// Where the info line answers a click: the send hint, and the unread count when something is unread.
pub(in crate::board) struct Hits {
    pub send: Option<Rect>,
    pub unread: Option<Rect>,
}
impl Info<'_> {
    fn left(&self, window: bool, words: bool, look: Look) -> Line<'static> {
        use ratatui::style::Modifier;
        let name_style = look
            .role(if self.focused { Role::Text } else { Role::Dim })
            .add_modifier(Modifier::BOLD);
        let text_role = if self.focused { Role::Muted } else { Role::Dim };
        let mut spans = vec![Span::styled(
            crate::board::notes::single_line(self.name),
            name_style,
        )];
        if let Some(unread) = self.unread {
            spans.push(Span::raw("  "));
            spans.push(if self.focused {
                crate::board::state_cell::unread_mark(unread, look)
                    .unwrap_or_else(|| Span::styled("●", look.role(Role::Muted)))
            } else {
                Span::styled(
                    if unread.total > 0 { "●" } else { "○" },
                    look.role(Role::Dim),
                )
            });
            spans.push(Span::styled(
                format!(
                    " {}{}{}",
                    unread.total,
                    if unread.more { "+" } else { "" },
                    if words { " unread" } else { "" }
                ),
                look.role(text_role),
            ));
        }
        if self.shell {
            spans.push(Span::styled(
                " · Run command",
                look.role(if self.focused {
                    Role::Waiting
                } else {
                    Role::Dim
                }),
            ));
        }
        if let Some(context) = self.context {
            let used = u128::from(context.used_tokens);
            let used_label = crate::source::tokens(used);
            let text = if let Some(limit) = context.window_tokens.filter(|limit| *limit > 0) {
                let limit = u128::from(limit);
                let percent = ((used * 100 + limit / 2) / limit).min(100);
                if window {
                    format!(
                        " · ctx {percent}% · {used_label} / {}",
                        crate::source::tokens(limit)
                    )
                } else {
                    format!(" · ctx {percent}% · {used_label}")
                }
            } else {
                format!(" · ctx {used_label}")
            };
            spans.push(Span::styled(text, look.role(text_role)));
        }
        Line::from(spans)
    }

    fn hints(&self, words: bool, gap: &str, look: Look) -> Line<'static> {
        let mut items: Vec<(String, String, Role)> = Vec::new();
        if let Some(key) = self.keep_reply_key.as_deref() {
            let (label, role) = if self.keep_reply {
                (" ⚑ keeping reply", Role::Waiting)
            } else {
                (" keep reply", Role::Muted)
            };
            items.push((
                key.to_owned(),
                if words {
                    label.to_owned()
                } else if self.keep_reply {
                    " ⚑".to_owned()
                } else {
                    String::new()
                },
                role,
            ));
        }
        items.push((
            crate::board::mentions::PRIMARY_TRIGGER.to_owned(),
            if words {
                " mention".to_owned()
            } else {
                String::new()
            },
            Role::Muted,
        ));
        if self.checklist {
            items.push((
                "^L".to_owned(),
                if words {
                    " checklist".to_owned()
                } else {
                    String::new()
                },
                Role::Muted,
            ));
        }
        let mut spans = Vec::new();
        for (index, (key, label, label_role)) in items.into_iter().enumerate() {
            if index > 0 {
                spans.push(Span::raw(gap.to_owned()));
            }
            let key_style = look.role(if self.focused {
                Role::Accent
            } else {
                Role::Dim
            });
            let label_style = look.role(if self.focused { label_role } else { Role::Dim });
            spans.push(Span::styled(key, key_style));
            if !label.is_empty() {
                spans.push(Span::styled(label, label_style));
            }
        }
        Line::from(spans)
    }

    pub(in crate::board) fn paint(
        &self,
        buffer: &mut Buffer,
        area: Rect,
        look: Look,
        hover: bool,
    ) -> Hits {
        let none = Hits {
            send: None,
            unread: None,
        };
        if area.is_empty() || area.height < 2 {
            return none;
        }
        let line = Rect::new(area.x, area.bottom() - 1, area.width, 1);
        let full_left = self.left(true, true, look);
        let full_hints_wide = self.hints(true, "    ", look);
        let full_hints = self.hints(true, "  ", look);
        let keys_hints = self.hints(false, "  ", look);
        let (left, right) =
            if full_left.width() + full_hints_wide.width() + 2 <= usize::from(line.width) {
                (full_left, full_hints_wide)
            } else if full_left.width() + full_hints.width() + 2 <= usize::from(line.width) {
                (full_left, full_hints)
            } else if full_left.width() + keys_hints.width() + 2 <= usize::from(line.width) {
                (full_left, keys_hints)
            } else {
                let used = self.left(false, true, look);
                let left = if used.width() + keys_hints.width() + 2 <= usize::from(line.width) {
                    used
                } else {
                    self.left(false, false, look)
                };
                let right = if keys_hints.width() + 2 <= usize::from(line.width) {
                    keys_hints
                } else {
                    Line::styled(
                        crate::board::mentions::PRIMARY_TRIGGER,
                        look.role(if self.focused {
                            Role::Accent
                        } else {
                            Role::Dim
                        }),
                    )
                };
                (left, right)
            };
        let width = right.width().min(usize::from(line.width)) as u16;
        let right_area = Rect::new(line.right() - width, line.y, width, 1);
        let left_area = Rect::new(line.x, line.y, line.width.saturating_sub(width + 2), 1);
        let unread = self
            .unread
            .is_some_and(|count| count.total > 0)
            .then(|| {
                // Name and two spaces, then the mark and its count: the spans `left` builds first.
                let before: usize = left.spans[..2].iter().map(Span::width).sum();
                let chip: usize = left.spans[2..4].iter().map(Span::width).sum();
                Rect::new(left_area.x + before as u16, line.y, chip as u16, 1)
                    .intersection(left_area)
            })
            .filter(|rect| !rect.is_empty());
        strip::paint_left(buffer, left_area, left);
        if let Some(rect) = unread.filter(|_| hover && self.focused) {
            let style = screen::chip(&look.theme, ChipKind::Secondary, ChipState::Hot, look.depth);
            for x in rect.x..rect.right() {
                buffer[(x, rect.y)].set_style(style);
            }
        }
        strip::paint_left(buffer, right_area, right);
        Hits { send: None, unread }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composer_footer_keeps_three_hints_with_accent_keys_and_dims_unfocused() {
        let look = Look::default();
        let focused = Info {
            name: "worker",
            focused: true,
            shell: false,
            checklist: true,
            keep_reply: false,
            keep_reply_key: Some("^T".into()),
            unread: Some(Count::default()),
            context: None,
        };
        let area = Rect::new(0, 0, 100, 2);
        let mut buffer = Buffer::empty(area);
        focused.paint(&mut buffer, area, look, false);
        let row: String = buffer.content[100..]
            .iter()
            .map(|cell| cell.symbol())
            .collect();
        assert!(
            row.trim_end()
                .ends_with("^T keep reply    @ mention    ^L checklist"),
            "{row:?}"
        );
        assert!(!row.contains("open request"), "{row:?}");
        assert!(!row.contains("⏎ send"), "{row:?}");
        assert!(!row.contains("new line"), "{row:?}");
        assert!(!row.contains("# item"), "{row:?}");

        let cell_at = |text: &str, needle: &str| {
            let byte = text.find(needle).unwrap();
            text[..byte].chars().count()
        };
        let t_col = cell_at(&row, "^T");
        assert_eq!(
            buffer.content[100 + t_col].fg,
            look.role(Role::Accent).fg.unwrap()
        );
        assert_eq!(buffer.content[100 + t_col].bg, ratatui::style::Color::Reset);

        // Active keep_reply renders `^T` (Accent) + ` ⚑ keeping reply` (Waiting).
        let active = Info {
            keep_reply: true,
            ..focused
        };
        let mut active_buf = Buffer::empty(area);
        active.paint(&mut active_buf, area, look, false);
        let active_row: String = active_buf.content[100..]
            .iter()
            .map(|cell| cell.symbol())
            .collect();
        assert!(
            active_row
                .trim_end()
                .ends_with("^T ⚑ keeping reply    @ mention    ^L checklist"),
            "{active_row:?}"
        );
        let flag_col = cell_at(&active_row, "⚑ keeping reply");
        assert_eq!(
            active_buf.content[100 + flag_col].fg,
            look.role(Role::Waiting).fg.unwrap()
        );

        // Unfocused dims the entire row.
        let unfocused = Info {
            focused: false,
            ..active
        };
        let mut dim_buf = Buffer::empty(area);
        unfocused.paint(&mut dim_buf, area, look, false);
        let dim_row: String = dim_buf.content[100..]
            .iter()
            .map(|cell| cell.symbol())
            .collect();
        let dim_t = cell_at(&dim_row, "^T");
        assert_eq!(
            dim_buf.content[100 + dim_t].fg,
            look.role(Role::Dim).fg.unwrap()
        );

        // At 80 cols with context, 4-space group gap fits; at 60 cols with context, it falls back to keys.
        let with_ctx = Info {
            focused: true,
            keep_reply: false,
            unread: None,
            context: Some(ContextUsage {
                used_tokens: 12_000,
                window_tokens: Some(200_000),
                observed_at_ms: 123,
            }),
            ..unfocused
        };
        let render_row = |width: u16| -> String {
            let area = Rect::new(0, 0, width, 2);
            let mut buf = Buffer::empty(area);
            with_ctx.paint(&mut buf, area, look, false);
            buf.content[usize::from(width)..]
                .iter()
                .map(|c| c.symbol())
                .collect()
        };
        let row80 = render_row(80);
        assert!(
            row80.contains("^T keep reply    @ mention    ^L checklist"),
            "{row80:?}"
        );
        let row60 = render_row(60);
        assert!(row60.ends_with("^T  @  ^L"), "{row60:?}");
    }

    #[test]
    fn context_keeps_known_zero_and_omits_an_unknown_window_and_observation() {
        let look = Look::default();
        let mut info = Info {
            name: "worker",
            focused: true,
            shell: false,
            checklist: false,
            keep_reply: false,
            keep_reply_key: None,
            unread: Some(Count::default()),
            context: None,
        };
        assert!(!info.left(true, true, look).to_string().contains("ctx"));
        info.context = Some(ContextUsage {
            used_tokens: 0,
            window_tokens: None,
            observed_at_ms: 123,
        });
        assert!(info.left(true, true, look).to_string().ends_with("ctx 0"));
        let context = info.context.as_mut().unwrap();
        context.window_tokens = Some(258000);
        context.used_tokens = 147000;
        assert!(
            info.left(true, true, look)
                .to_string()
                .ends_with("ctx 57% · 147k / 258k")
        );
        let mut buffer = Buffer::empty(Rect::new(0, 0, 40, 4));
        let area = buffer.area;
        info.paint(&mut buffer, area, look, false);
        let row: String = buffer
            .content
            .chunks(40)
            .nth(3)
            .unwrap()
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(row.contains('@'), "{row:?}");
    }
}
