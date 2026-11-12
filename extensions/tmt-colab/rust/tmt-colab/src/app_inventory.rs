//! Shared build-time and runtime admission of exact browser asset bytes.
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::LazyLock};

pub const APP_BYTES: usize = 16 * 1024 * 1024;
pub const APP_FILES: usize = 128;

/// The top-level app files, declared once for this inventory and the packaging proof.
const ENTRIES: &str = include_str!("../app-entries.txt");

/// Top-level file names of one kind (`html` or `text`) from `app-entries.txt`.
fn entries(kind: &'static str) -> impl Iterator<Item = &'static str> {
    ENTRIES.lines().filter_map(move |line| {
        let (declared, name) = line.split_once(' ')?;
        (declared == kind).then_some(name)
    })
}

/// Only the one pinned renderer binary is admitted, in native and build inventories.
static TERMINAL_PIN: LazyLock<(String, String, usize)> = LazyLock::new(|| {
    let pin: serde_json::Value =
        serde_json::from_str(include_str!("../../../typescript/app/runtime-pin.json"))
            .expect("runtime pin is JSON");
    let wasm = pin["chunks"]
        .as_array()
        .expect("runtime chunks")
        .iter()
        .find(|chunk| chunk["kind"] == "wasm")
        .expect("one renderer pin");
    (
        format!("/{}", wasm["path"].as_str().expect("renderer path")),
        wasm["sha256"].as_str().expect("renderer hash").to_owned(),
        wasm["length"].as_u64().expect("renderer length") as usize,
    )
});

pub fn is_terminal_wasm(route: &str) -> bool {
    route == TERMINAL_PIN.0
}

pub fn terminal_wasm_matches(bytes: &[u8]) -> bool {
    let digest = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    bytes.len() == TERMINAL_PIN.2 && bytes.len() <= 614_400 && digest == TERMINAL_PIN.1
}

pub fn content_type(route: &str) -> Option<&'static str> {
    if is_terminal_wasm(route) {
        return Some("application/wasm");
    }
    let top = route.strip_prefix('/')?;
    if entries("html").any(|entry| entry == top) {
        return Some("text/html; charset=utf-8");
    }
    if entries("text").any(|entry| entry == top) {
        return Some("text/plain; charset=utf-8");
    }
    let name = route.strip_prefix("/assets/")?;
    if name.starts_with('.')
        || name.is_empty()
        || name.len() > 128
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return None;
    }
    Some(match name.rsplit('.').next()? {
        "html" => "text/html; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        _ => return None,
    })
}

pub fn validate(files: &[(&str, &[u8])]) -> Result<(), &'static str> {
    if files.len() > APP_FILES {
        return Err("App has too many assets.");
    }
    let mut total = 0usize;
    let mut inventory = BTreeMap::new();
    for &(route, bytes) in files {
        if content_type(route).is_none() {
            return Err("Unsupported or unsafe app asset route.");
        }
        if is_terminal_wasm(route) && !terminal_wasm_matches(bytes) {
            return Err("Terminal renderer does not match its pin.");
        }
        total = total.checked_add(bytes.len()).ok_or("App size overflow.")?;
        if bytes.is_empty() || total > APP_BYTES {
            return Err("App assets must be nonempty and bounded.");
        }
        if inventory.insert(route, bytes).is_some() {
            return Err("Duplicate app asset route.");
        }
    }
    for name in entries("html") {
        if !inventory.contains_key(format!("/{name}").as_str()) {
            return Err("A declared app entry is missing.");
        }
    }
    for name in entries("html") {
        if let Some(bytes) = inventory.get(format!("/{name}").as_str()) {
            let html = std::str::from_utf8(bytes).map_err(|_| "App HTML must be UTF-8.")?;
            for reference in html.split("\"./assets/").skip(1) {
                let name = reference
                    .split('"')
                    .next()
                    .ok_or("Invalid app entry reference.")?;
                if !inventory.contains_key(format!("/assets/{name}").as_str()) {
                    return Err("App entry asset is missing.");
                }
            }
        }
    }
    for kind in ["text/javascript; charset=utf-8", "text/css; charset=utf-8"] {
        if !inventory
            .keys()
            .any(|route| content_type(route) == Some(kind))
        {
            return Err("App build requires JavaScript and CSS.");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_wasm_is_the_only_binary_route_and_must_match_its_pin() {
        let wasm: &[u8] =
            include_bytes!("../../../typescript/app/terminal-frame-assets/tmt_tui_wasm_bg.wasm");
        assert_eq!(content_type(&TERMINAL_PIN.0), Some("application/wasm"));
        assert_eq!(content_type("/assets/unrelated.wasm"), None);
        assert_eq!(
            content_type("/assets/colab-runtime-terminal-0000000000000000.wasm"),
            None
        );
        let page: &[u8] = b"<html></html>";
        let files = [
            ("/index.html", page),
            ("/renderer.html", page),
            ("/reader.html", page),
            ("/assets/a.js", b"js" as &[u8]),
            ("/assets/a.css", b"css" as &[u8]),
            (TERMINAL_PIN.0.as_str(), wasm),
        ];
        assert_eq!(validate(&files), Ok(()));
        let mut changed = wasm.to_vec();
        changed[0] ^= 1;
        let mut bad = files;
        bad[5].1 = &changed;
        assert_eq!(
            validate(&bad),
            Err("Terminal renderer does not match its pin.")
        );
    }

    #[test]
    fn declared_entries_are_the_only_top_level_files() {
        let html: Vec<_> = entries("html").collect();
        assert_eq!(html, ["index.html", "renderer.html", "reader.html"]);
        assert_eq!(
            entries("text").collect::<Vec<_>>(),
            ["THIRD-PARTY-NOTICES.txt"]
        );
        for name in &html {
            assert_eq!(
                content_type(&format!("/{name}")),
                Some("text/html; charset=utf-8")
            );
        }
        assert_eq!(
            content_type("/THIRD-PARTY-NOTICES.txt"),
            Some("text/plain; charset=utf-8")
        );
        for undeclared in ["/other.html", "/index.js", "/", "/app-entries.txt"] {
            assert_eq!(content_type(undeclared), None, "{undeclared}");
        }
    }

    #[test]
    fn every_declared_html_entry_is_required() {
        let page: &[u8] = b"<html></html>";
        let complete = [
            ("/index.html", page),
            ("/renderer.html", page),
            ("/reader.html", page),
            ("/assets/a.js", b"js"),
            ("/assets/a.css", b"css"),
        ];
        assert_eq!(validate(&complete), Ok(()));
        for missing in ["/index.html", "/renderer.html", "/reader.html"] {
            let files: Vec<_> = complete
                .iter()
                .copied()
                .filter(|f| f.0 != missing)
                .collect();
            assert!(validate(&files).is_err(), "{missing}");
        }
    }
}
