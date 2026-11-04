//! Local Colab page links (#6008; `/colab/p/<id>` or `/p/<id>`, #6050): the conversation paints a
//! fixed-width chip instead of the long address, a card names the page while the chip is hovered
//! or focused, and a click or Enter opens it in the browser. Other web links keep their popover.
//!
//! The title is read from this machine's Colab (`tmt colab show PAGE --json`) once per page, off
//! the paint path; until it arrives, or when it cannot be read, the card still opens the page.
use super::{Hit, Target};
use crate::board::app::App;
use ratatui::{
    Frame,
    layout::Rect,
    text::{Line, Span},
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tmt_cli_style::Role;
use unicode_width::UnicodeWidthStr;

/// The page ID's first eight characters when `url` is a page on this machine's Colab.
pub(in crate::board) fn page(url: &str) -> Option<&str> {
    let rest = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))?;
    let (authority, path) = rest.split_once('/')?;
    // Agent text is untrusted: a plain host[:port] only, so userinfo (`127.0.0.1@evil`),
    // percent-encoding or any other authority syntax never passes for this machine.
    let (host, port) = match authority.strip_prefix("[::1]") {
        Some(port) => ("[::1]", port),
        None => authority.split_at(authority.find(':').unwrap_or(authority.len())),
    };
    let port = port.strip_prefix(':').unwrap_or(port);
    if !port.bytes().all(|byte| byte.is_ascii_digit())
        || !(host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "[::1]")
    {
        return None;
    }
    // The page shapes Colab's own open accepts (#6050): `/colab/p/<id>` and the older `/p/<id>`,
    // which a browser Ask still links when the page is open at that address.
    let id = path
        .strip_prefix("colab/p/")
        .or_else(|| path.strip_prefix("p/"))?;
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

/// How long an unreadable title stands before the next ask reads it again (#6011): Colab may
/// start serving after the first hover.
const RETRY: Duration = Duration::from_secs(10);

/// Page titles by ID, read in the background: once when read, again after [`RETRY`] when not.
pub(in crate::board) struct Titles {
    known: Arc<Mutex<HashMap<String, (Title, Instant)>>>,
    read: Reader,
    retry: Duration,
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
            retry: RETRY,
        }
    }
}

impl Titles {
    #[cfg(test)]
    pub(in crate::board) fn with(
        read: impl Fn(&str) -> Option<String> + Send + Sync + 'static,
        retry: Duration,
    ) -> Self {
        Self {
            known: Arc::default(),
            read: Arc::new(read),
            retry,
        }
    }

    /// The title as far as it is known; the first ask, or the first after an unreadable title
    /// has stood for the retry interval, starts reading it.
    pub(in crate::board) fn get(&self, id: &str) -> Title {
        let mut known = self.known.lock().unwrap_or_else(|error| error.into_inner());
        match known.get(id) {
            Some((Title::Unreadable, at)) if at.elapsed() >= self.retry => {}
            Some((title, _)) => return title.clone(),
            None => {}
        }
        known.insert(id.to_owned(), (Title::Reading, Instant::now()));
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
                .insert(page, (title, Instant::now()));
        };
        #[cfg(test)]
        work();
        #[cfg(not(test))]
        std::thread::spawn(work);
        self.known
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(id)
            .map_or(Title::Reading, |(title, _)| title.clone())
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
    let rows = [
        (fit(&title), look.role(Role::Text).bold()),
        (fit(&detail), look.role(Role::Dim)),
        (fit(hint), look.role(Role::Dim)),
    ];
    let content = rows.iter().map(|(text, _)| text.width()).max().unwrap_or(0);
    let width = content as u16 + 4;
    let height = rows.len() as u16 + 2;
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
    let border = look.role(Role::Dim);
    let rule = "─".repeat(content + 2);
    let mut lines = vec![Line::styled(format!("╭{rule}╮"), border)];
    lines.extend(rows.into_iter().map(|(text, style)| {
        let pad = " ".repeat(content - text.width());
        Line::from(vec![
            Span::styled("│ ", border),
            Span::styled(text, style),
            Span::raw(pad),
            Span::styled(" │", border),
        ])
    }));
    lines.push(Line::styled(format!("╰{rule}╯"), border));
    crate::board::view::overlay_lines(frame, Rect::new(x, y, width, height), lines);
}

#[cfg(test)]
mod tests {
    use super::*;

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
            ("http://LOCALHOST:5100/colab/p/4204d993", "4204d993"),
            ("http://127.0.0.1/colab/p/4204d993", "4204d993"),
            ("http://127.0.0.1:50711/p/36b98efb", "36b98efb"),
            (
                "http://localhost:5100/p/4204d993-29fe-4d86-837b-94ef96c14180#c",
                "4204d993",
            ),
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
            "http://127.0.0.1:80@evil.example/colab/p/36b98efb",
            "http://127.0.0.1@evil.example/colab/p/36b98efb",
            "http://user@127.0.0.1:5100/colab/p/36b98efb",
            "http://%31%32%37.0.0.1:5100/colab/p/36b98efb",
            "http://127.0.0.1:5100x/colab/p/36b98efb",
            "http://[::1]evil/colab/p/36b98efb",
            "https://example.com/p/36b98efb",
            "http://127.0.0.1:50711/x/p/36b98efb",
            "http://127.0.0.1:50711/p/36b9",
            "http://user@127.0.0.1:5100/p/36b98efb",
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
        let titles = Titles::with(
            move |id| {
                *counted.lock().unwrap() += 1;
                (id == "36b98efb").then(|| "Night plan".to_owned())
            },
            RETRY,
        );
        assert_eq!(titles.get("36b98efb"), Title::Read("Night plan".into()));
        assert_eq!(titles.get("36b98efb"), Title::Read("Night plan".into()));
        assert_eq!(titles.get("4204d993"), Title::Unreadable);
        assert_eq!(
            titles.get("4204d993"),
            Title::Unreadable,
            "not again within the interval"
        );
        assert_eq!(*reads.lock().unwrap(), 2);
    }

    /// #6011: Colab started after the first hover; an unreadable title is read again once the
    /// interval has passed, and a read title is never read again.
    #[test]
    fn an_unreadable_title_is_read_again_after_the_interval() {
        let reads = Arc::new(Mutex::new(0));
        let counted = Arc::clone(&reads);
        let titles = Titles::with(
            move |_| {
                let mut reads = counted.lock().unwrap();
                *reads += 1;
                (*reads > 1).then(|| "Night plan".to_owned())
            },
            Duration::ZERO,
        );
        assert_eq!(titles.get("36b98efb"), Title::Unreadable);
        assert_eq!(titles.get("36b98efb"), Title::Read("Night plan".into()));
        assert_eq!(titles.get("36b98efb"), Title::Read("Night plan".into()));
        assert_eq!(*reads.lock().unwrap(), 2);
    }
}
