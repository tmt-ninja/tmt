//! Local Colab page links (#6008): the conversation paints a fixed-width chip instead of the
//! long address, a card names the page while the chip is hovered or focused, and a click or
//! Enter opens it in the browser. Other web links keep their popover.
//!
//! The title is read from this machine's Colab (`tmt colab show PAGE --json`) once per page, off
//! the paint path; until it arrives, or when it cannot be read, the card still opens the page.
use super::{Hit, Target};
use crate::board::app::App;
use ratatui::{
    Frame,
    layout::Rect,
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph},
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tmt_cli_style::Role;

/// The page ID's first eight characters when `url` is a page on this machine's Colab.
pub(in crate::board) fn page(url: &str) -> Option<&str> {
    let rest = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))?;
    let (authority, path) = rest.split_once('/')?;
    let host = if authority.starts_with('[') {
        &authority[..=authority.find(']')?]
    } else {
        authority.split(':').next()?
    };
    if !matches!(host, "127.0.0.1" | "localhost" | "[::1]") {
        return None;
    }
    let id = path.strip_prefix("colab/p/")?;
    let id = &id[..id.find(['/', '?', '#']).unwrap_or(id.len())];
    (id.len() >= 8
        && id[..8].bytes().all(|byte| byte.is_ascii_hexdigit())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-'))
    .then(|| &id[..8])
}

/// What the conversation shows in place of a local Colab address.
pub(in crate::board) fn chip(id: &str) -> String {
    format!("▤ Colab · {id} ↗")
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum Title {
    Reading,
    Read(String),
    Unreadable,
}

type Reader = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

/// Page titles by ID, each read once in the background.
pub(in crate::board) struct Titles {
    known: Arc<Mutex<HashMap<String, Title>>>,
    read: Reader,
}

impl Default for Titles {
    fn default() -> Self {
        // Tests never reach the host's Colab store.
        #[cfg(test)]
        let read: Reader = Arc::new(|_: &str| None);
        #[cfg(not(test))]
        let read: Reader = Arc::new(read_title);
        Self {
            known: Arc::default(),
            read,
        }
    }
}

impl Titles {
    #[cfg(test)]
    pub(in crate::board) fn with(
        read: impl Fn(&str) -> Option<String> + Send + Sync + 'static,
    ) -> Self {
        Self {
            known: Arc::default(),
            read: Arc::new(read),
        }
    }

    /// The title as far as it is known; the first ask starts reading it.
    pub(in crate::board) fn get(&self, id: &str) -> Title {
        let mut known = self.known.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(title) = known.get(id) {
            return title.clone();
        }
        known.insert(id.to_owned(), Title::Reading);
        drop(known);
        let (known, read, page) = (
            Arc::clone(&self.known),
            Arc::clone(&self.read),
            id.to_owned(),
        );
        let work = move || {
            let title = read(&page).map_or(Title::Unreadable, Title::Read);
            known
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .insert(page, title);
        };
        #[cfg(test)]
        work();
        #[cfg(not(test))]
        std::thread::spawn(work);
        self.known
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(id)
            .cloned()
            .unwrap_or(Title::Reading)
    }
}

#[cfg(not(test))]
fn read_title(id: &str) -> Option<String> {
    let core = crate::core::Core::discover().ok()?;
    let page = core
        .json_within(
            &["colab", "show", id, "--json"],
            std::time::Duration::from_secs(5),
        )
        .ok()?;
    let title = crate::board::notes::single_line(page["page"]["title"].as_str()?);
    (!title.is_empty()).then_some(title)
}

/// The card for a hovered or focused Colab chip, inside `surface` (the screen), below the
/// chip when it fits and above it otherwise.
pub(super) fn paint_card(frame: &mut Frame, app: &App, surface: Rect, hit: &Hit) {
    let Target::Url(url) = &hit.target else {
        return;
    };
    let Some(id) = page(url) else {
        return;
    };
    let look = app.look();
    let (title, detail) = match app.member_links.borrow().titles.get(id) {
        Title::Read(title) => (title, format!("Colab · {id}")),
        Title::Reading => ("Reading title…".to_owned(), format!("Colab · {id}")),
        Title::Unreadable => (
            "Title unavailable".to_owned(),
            "Colab is not serving or has no access".to_owned(),
        ),
    };
    let hint = "Enter or click opens it in the browser";
    let inner = usize::from(surface.width.saturating_sub(4));
    if inner < 8 {
        return;
    }
    let fit = |text: &str| crate::board::view::fit(text, inner);
    let lines = vec![
        Line::from(Span::styled(fit(&title), look.role(Role::Text).bold())),
        Line::from(Span::styled(fit(&detail), look.role(Role::Dim))),
        Line::from(Span::styled(fit(hint), look.role(Role::Dim))),
    ];
    let width = lines.iter().map(Line::width).max().unwrap_or(0) as u16 + 4;
    let height = lines.len() as u16 + 2;
    let below = hit.area.bottom();
    let y = if below + height <= surface.bottom() {
        below
    } else if hit.area.y >= surface.y + height {
        hit.area.y - height
    } else {
        return;
    };
    let x = hit
        .area
        .x
        .min(surface.right().saturating_sub(width))
        .max(surface.x);
    let area = Rect::new(x, y, width.min(surface.width), height);
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(lines).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(look.role(Role::Dim))
                .padding(ratatui::widgets::Padding::horizontal(1)),
        ),
        area,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use unicode_width::UnicodeWidthStr;

    #[test]
    fn only_page_links_on_this_machine_become_chips() {
        for (url, id) in [
            ("http://127.0.0.1:50711/colab/p/36b98efb", "36b98efb"),
            (
                "http://127.0.0.1:50711/colab/p/36b98efb-29fe-4d86-837b-94ef96c14180",
                "36b98efb",
            ),
            ("http://localhost:5100/colab/p/4204d993?x=1#c", "4204d993"),
            ("http://[::1]:5100/colab/p/4204d993/", "4204d993"),
        ] {
            assert_eq!(page(url), Some(id), "{url}");
        }
        for url in [
            "https://example.com/colab/p/36b98efb",
            "http://127.0.0.1.evil/colab/p/36b98efb",
            "http://127.0.0.1:50711/colab/",
            "http://127.0.0.1:50711/colab/p/36b9",
            "http://127.0.0.1:50711/colab/p/36b98efz",
            "http://127.0.0.1:50711/x/colab/p/36b98efb",
            "javascript:alert(1)",
        ] {
            assert_eq!(page(url), None, "{url}");
        }
        assert_eq!(chip("36b98efb"), "▤ Colab · 36b98efb ↗");
        assert_eq!(chip("36b98efb").width(), 20, "a fixed width for every page");
    }

    #[test]
    fn a_title_is_read_once_and_an_unreadable_page_says_so() {
        let reads = Arc::new(Mutex::new(0));
        let counted = Arc::clone(&reads);
        let titles = Titles::with(move |id| {
            *counted.lock().unwrap() += 1;
            (id == "36b98efb").then(|| "Night plan".to_owned())
        });
        assert_eq!(titles.get("36b98efb"), Title::Read("Night plan".into()));
        assert_eq!(titles.get("36b98efb"), Title::Read("Night plan".into()));
        assert_eq!(titles.get("4204d993"), Title::Unreadable);
        assert_eq!(*reads.lock().unwrap(), 2);
    }
}
