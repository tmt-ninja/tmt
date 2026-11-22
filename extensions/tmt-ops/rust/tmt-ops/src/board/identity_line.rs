//! The selected squad identity over already acquired display values.
use crate::look::Look;
use ratatui::text::{Line, Span};
use tmt_cli_style::Role;

pub(in crate::board) fn squad(
    lead: Option<&str>,
    state: Line<'static>,
    room: &str,
    look: Look,
) -> Line<'static> {
    let mut spans = vec![Span::styled(
        format!(
            " lead {} · ",
            crate::board::notes::single_line(lead.unwrap_or("—"))
        ),
        look.role(Role::Muted),
    )];
    spans.extend(state.spans);
    spans.push(Span::styled(
        format!(" · room {}", crate::board::notes::single_line(room)),
        look.role(Role::Muted),
    ));
    Line::from(spans)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_squad_lead_stays_unknown_and_room_text_is_inert() {
        let look = Look::default();
        assert_eq!(
            squad(None, Line::raw("? unreported"), "room\nname", look).to_string(),
            " lead — · ? unreported · room room name"
        );
    }
}
