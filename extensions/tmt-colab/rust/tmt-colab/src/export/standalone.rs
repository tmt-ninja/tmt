//! The standalone copy of a page that opts in to the bundled runtime (#1693) or uses the design
//! system (#5057).
//!
//! `page.html` is the exact admitted source and never changes. For a page whose source asks for the
//! runtime or uses the design system, the export adds `page.standalone.html`: the same document the
//! renderer frame builds, with the runtime's and the design system's scripts and styles written
//! into its head, so the page looks and works when it is opened from disk with no Colab and no
//! network. The browser build writes the same bytes (`typescript/app/src/standalone.ts`);
//! `vectors/export-v1.json` pins both.

use crate::{
    assets::RENDERER_POLICY,
    design_bundle::{BUILT_IN_BUNDLE, bundle_hash},
    page_check,
};
use serde::Serialize;
use serde_json::Value;

/// The published name of the derived file.
pub const FILE: &str = "page.standalone.html";
/// The file it is derived from, as the manifest records it.
pub const DERIVED_FROM: &str = "page.html";
/// A marker whose content has this space-separated token asks for React (#6077). Every page gets
/// Tailwind, so `tailwind` asks for nothing more; unknown tokens are ignored.
const REACT: &str = "react";
const MARKER: &str = "tmt-colab-runtime";
/// What a page without React compiles before the theme (#6077): Tailwind's theme and utilities and
/// no preflight, and the canvas the theme paints for a React page taken back. With no `@import` of
/// its own the browser compiler imports all of Tailwind, preflight included, which a React page
/// keeps. The browser build holds the same text.
pub const UTILITIES_ONLY: &str = "@layer theme, base, components, utilities;@import \"tailwindcss/theme.css\" layer(theme);@import \"tailwindcss/utilities.css\" layer(utilities);@layer base{:root{background-color:revert-layer}}\n";
/// The theme follows `data-theme` only, so the copy sets it from the system colour scheme and
/// follows changes, the way Colab's own pages follow the app theme. The browser build holds the
/// same text.
pub const THEME_SWITCH: &str = "(()=>{const q=matchMedia('(prefers-color-scheme: dark)'),r=document.documentElement,s=()=>{r.dataset.theme=q.matches?'dark':'light'};s();q.addEventListener('change',s)})()";

/// Why a page that needs a copy got none.
pub const NO_RUNTIME: &str = "runtime-unavailable";
pub const TOO_DEEP: &str = "page-too-deep";
pub const UNUSABLE: &str = "runtime-unusable";
pub const NO_DESIGN: &str = "design-unavailable";
pub const DESIGN_UNUSABLE: &str = "design-unusable";
/// Why a page's pinned design system could not be carried (#6157): the frame's failures for its
/// pin, a release this export could not read (the serve that reads attachments is not running, or
/// the bytes are not the release), and a page that follows a space system's draft, which only the
/// browser can compile.
pub const DESIGN_UNKNOWN_RELEASE: &str = "design-unknown-release";
pub const DESIGN_HASH_MISMATCH: &str = "design-hash-mismatch";
pub const DESIGN_NEWER_RUNTIME: &str = "design-newer-runtime";
pub const DESIGN_NEWER_SCHEMA: &str = "design-newer-schema";
pub const DESIGN_RELEASE_UNAVAILABLE: &str = "design-release-unavailable";
pub const DESIGN_DRAFT_UNAVAILABLE: &str = "design-draft-unavailable";
/// The built-in system's id, which every install can pin (`BUILT_IN_SYSTEM` in the app).
const BUILT_IN_SYSTEM: &str = "tmt-gui";
/// The bundle runtimes the frame's skeleton supports (`design-system.ts`).
const RUNTIMES: [&str; 3] = ["2", "3", "4"];

/// The two texts the page runtime adds: every runtime chunk of one build in load order, then the
/// renderer's seal (`App::runtime_script`, #6085), and that build's `assets/colab-runtime.css`.
#[derive(Clone, Copy)]
pub struct Runtime<'a> {
    pub script: &'a str,
    pub style: &'a str,
}

/// The two texts the design system adds (#5057): `script` and `style` of the same build's
/// `assets/colab-page-ui.json`, which are what the renderer frame carries.
#[derive(Clone, Copy)]
pub struct Design<'a> {
    pub script: &'a str,
    pub style: &'a str,
}

/// What a copy of a page that pins a design system carries from the build (#6157): the runtime
/// theme, every runtime chunk's text by name in load order, and the binder, which checks them and
/// the bundle when the file opens. Each is the pinned file (`App::standalone_runtime`).
#[derive(Clone, Copy)]
pub struct Standalone<'a> {
    pub theme: &'a str,
    pub binder: &'a str,
    pub chunks: &'a [(&'a str, &'a str)],
}

/// What the build has to offer a copy; each is absent when the build lacks its files.
#[derive(Clone, Copy, Default)]
pub struct Assets<'a> {
    /// All of the runtime, for a page that asks for React.
    pub runtime: Option<Runtime<'a>>,
    /// The base alone and the theme after [`UTILITIES_ONLY`], for any other page (#6077).
    pub base: Option<Runtime<'a>>,
    pub design: Option<Design<'a>>,
    pub standalone: Option<Standalone<'a>>,
}

/// Where the export reads a space system's locked release: the system root page's release
/// attachment, as `tmt colab design show` reads it. The built-in system ships in this executable.
pub trait Releases {
    /// The release bundle, or `None` when it cannot be read; the caller verifies it.
    fn release(&self, system: &str, version: &str, hash: &str) -> Option<Value>;
}
/// No release can be read: only the built-in system is carried.
pub struct NoReleases;
impl Releases for NoReleases {
    fn release(&self, _: &str, _: &str, _: &str) -> Option<Value> {
        None
    }
}

/// A page's pin (`design-system.ts` `parsePin`): the system, and the release it locks, if any.
struct Pin<'a> {
    system: &'a str,
    lock: Option<(&'a str, &'a str)>,
}
fn parse_pin(content: &str) -> Option<Pin<'_>> {
    // JavaScript's `trim` also removes U+FEFF.
    let content = content.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let (system, lock) = match content.split_once('@') {
        Some((system, lock)) => (system, Some(lock)),
        None => (content, None),
    };
    let id = |text: &str| {
        (1..=128).contains(&text.len())
            && text
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    };
    if !id(system) {
        return None;
    }
    let lock = match lock {
        None => None,
        Some(lock) => {
            let (version, hash) = lock.split_once('#')?;
            let parts: Vec<&str> = version.split('.').collect();
            let digits = |part: &&str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
            let hex = hash.strip_prefix("sha256-")?;
            if parts.len() != 3
                || !parts.iter().all(digits)
                || hex.len() != 64
                || !hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
            {
                return None;
            }
            Some((version, hash))
        }
    };
    Some(Pin { system, lock })
}

/// `design-system.ts` `verifyRelease`, without the capability check that only the binder can make
/// when the file opens.
fn verify(bundle: Value, version: &str, hash: &str) -> Result<Value, &'static str> {
    if bundle["version"] != version {
        return Err(DESIGN_UNKNOWN_RELEASE);
    }
    if bundle["schema"].as_f64().is_some_and(|schema| schema > 1.0) {
        return Err(DESIGN_NEWER_SCHEMA);
    }
    if bundle["hash"] != hash || bundle_hash(&bundle).as_deref() != Some(hash) {
        return Err(DESIGN_HASH_MISMATCH);
    }
    supported(bundle)
}
fn supported(bundle: Value) -> Result<Value, &'static str> {
    if bundle["runtime"]
        .as_str()
        .is_some_and(|runtime| RUNTIMES.contains(&runtime))
    {
        Ok(bundle)
    } else {
        Err(DESIGN_NEWER_RUNTIME)
    }
}

/// The verified bundle the page's pin names, as the app resolves it: the built-in system from this
/// executable (its draft is its release), a space system's locked release from `releases`.
fn pinned_bundle(pin: &Pin, releases: &dyn Releases) -> Result<Value, &'static str> {
    if pin.system == BUILT_IN_SYSTEM {
        let bundle: Value =
            serde_json::from_str(BUILT_IN_BUNDLE).map_err(|_| DESIGN_UNKNOWN_RELEASE)?;
        return match pin.lock {
            Some((version, hash)) => verify(bundle, version, hash),
            None => supported(bundle),
        };
    }
    let (version, hash) = pin.lock.ok_or(DESIGN_DRAFT_UNAVAILABLE)?;
    let bundle = releases
        .release(pin.system, version, hash)
        .ok_or(DESIGN_RELEASE_UNAVAILABLE)?;
    verify(bundle, version, hash)
}

/// What a page that pins a design system adds (`StandaloneDesignSystem` in the app): the verified
/// bundle's JSON, the page's pin, the release it was verified as (`<version>#<hash>`), whether the
/// page keeps the editorial ramp, and the build's pinned runtime and binder.
pub struct DesignSystem<'a> {
    pub bundle: String,
    pub pin: String,
    pub lock: String,
    pub prose: bool,
    pub runtime: Standalone<'a>,
}

/// What became of the copy, reported next to the files; absent for a page that needs none.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Outcome {
    pub included: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

/// The copy's bytes, when it could be made, with its outcome.
pub struct Derived {
    pub outcome: Outcome,
    pub file: Option<Vec<u8>>,
}

/// One sentence for the human output; the JSON carries only the code.
#[must_use]
pub fn explanation(reason: &str) -> &'static str {
    match reason {
        NO_RUNTIME => "this build carries no page runtime",
        TOO_DEEP => "the page nests too deeply to read its runtime marker",
        UNUSABLE => "this build's page runtime cannot be written into an HTML file",
        NO_DESIGN => "this build carries no page design system",
        DESIGN_UNUSABLE => "this build's page design system cannot be written into an HTML file",
        DESIGN_UNKNOWN_RELEASE => "the page pins a design system release this TMT does not have",
        DESIGN_HASH_MISMATCH => "the page's design system bundle does not match its pin",
        DESIGN_NEWER_RUNTIME | DESIGN_NEWER_SCHEMA => {
            "the page needs a newer TMT to show its components"
        }
        DESIGN_RELEASE_UNAVAILABLE => {
            "the page's design system release could not be read; run tmt colab serve and export again"
        }
        DESIGN_DRAFT_UNAVAILABLE => {
            "the page follows a design system draft; export its copy from the browser"
        }
        _ => "unknown reason",
    }
}

/// Whether `source` asks for React: the first `<meta name="tmt-colab-runtime">` in document
/// order, found by parsing, has a `content` with the `react` token. The same cases run in the app
/// (`vectors/runtime-marker-v1.json`).
pub fn wants_react(source: &str) -> Result<bool, page_check::TooDeep> {
    if !source.contains(MARKER) {
        return Ok(false);
    }
    Ok(page_check::runtime_marker(source)?
        .is_some_and(|content| content.split_ascii_whitespace().any(|token| token == REACT)))
}

/// Whether `source` carries the marker at all, whatever its tokens: the frame keeps the editorial
/// ramp for a design-system page that did not ask for the runtime itself (#5917).
fn has_marker(source: &str) -> Result<bool, page_check::TooDeep> {
    Ok(source.contains(MARKER) && page_check::runtime_marker(source)?.is_some())
}

pub use crate::page_check::uses_design;

/// The renderer frame's policy without its `sandbox` directive, the one a `<meta>` cannot carry:
/// the copy gains no network when it is opened from disk, but it is not sandboxed.
#[must_use]
pub fn meta_policy() -> &'static str {
    RENDERER_POLICY
        .split_once("; sandbox")
        .map_or(RENDERER_POLICY, |(policy, _)| policy)
}

/// The copy's document, or the reason it cannot be made: a text that could end its own element
/// or open a comment would let it escape the head block. The build already refuses both, so this
/// is a guard. The head holds, in order, the design style and the runtime's theme (the frame
/// carries them in that order), the theme switch, then the design script and the runtime script;
/// a page that needs only the runtime gets the same bytes as before the design system.
pub fn document(source: &str, assets: &Assets) -> Result<Vec<u8>, &'static str> {
    document_with(source, assets, None)
}

/// [`document`], and for a page that pins a design system its inert blocks and the binder in place
/// of the runtime script (#6157); the runtime's theme then comes with them.
pub fn document_with(
    source: &str,
    assets: &Assets,
    design_system: Option<&DesignSystem>,
) -> Result<Vec<u8>, &'static str> {
    let unsafe_in = |text: &str, closing: &str| {
        text.contains("<!--") || text.to_ascii_lowercase().contains(closing)
    };
    let runtime = assets.runtime.filter(|_| design_system.is_none());
    let assets = &Assets { runtime, ..*assets };
    if let Some(runtime) = &assets.runtime
        && (unsafe_in(runtime.script, "</script") || unsafe_in(runtime.style, "</style"))
    {
        return Err(UNUSABLE);
    }
    if let Some(design) = &assets.design
        && (unsafe_in(design.script, "</script") || unsafe_in(design.style, "</style"))
    {
        return Err(DESIGN_UNUSABLE);
    }
    let design_attribute = if assets.design.is_some() {
        " data-colab-design"
    } else {
        ""
    };
    let design_style = assets.design.map_or_else(String::new, |design| {
        format!("<style>{}</style>", design.style)
    });
    let theme = design_system
        .map(|ds| ds.runtime.theme)
        .or(assets.runtime.map(|runtime| runtime.style));
    let runtime_style = theme.map_or_else(String::new, |theme| {
        format!("<style type=\"text/tailwindcss\">{theme}</style>")
    });
    let design_script = assets.design.map_or_else(String::new, |design| {
        format!("<script>{}</script>", design.script)
    });
    let runtime_script = assets.runtime.map_or_else(String::new, |runtime| {
        format!("<script>{}</script>", runtime.script)
    });
    let blocks = match design_system {
        None => String::new(),
        Some(ds) => blocks(ds, &unsafe_in).ok_or(UNUSABLE)?,
    };
    Ok(format!(
        "<!doctype html><html{design_attribute}><head><meta http-equiv=\"Content-Security-Policy\" content=\"{policy}\">\
         <meta charset=\"utf-8\">{design_style}{runtime_style}<script>{THEME_SWITCH}</script>\
         {design_script}{runtime_script}{blocks}</head><body>{source}</body></html>",
        policy = meta_policy(),
    )
    .into_bytes())
}

/// The bundle block, each chunk's inert block and the binder, or `None` when a text could leave
/// its element or a value could leave its attribute.
fn blocks(ds: &DesignSystem, unsafe_in: &dyn Fn(&str, &str) -> bool) -> Option<String> {
    let attribute = |value: &str| {
        (1..=256).contains(&value.len())
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'@' | b'#' | b'-'))
    };
    if !attribute(&ds.pin)
        || !attribute(&ds.lock)
        || ds
            .runtime
            .chunks
            .iter()
            .any(|(name, text)| !attribute(name) || unsafe_in(text, "</script"))
        || unsafe_in(ds.runtime.binder, "</script")
        || unsafe_in(ds.runtime.theme, "</style")
    {
        return None;
    }
    let prose = if ds.prose { " data-prose" } else { "" };
    let mut out = format!(
        "<script type=\"application/json\" id=\"tmt-ds-bundle\" data-pin=\"{}\" data-lock=\"{}\"{prose}>{}</script>",
        ds.pin,
        ds.lock,
        ds.bundle.replace('<', "\\u003c"),
    );
    for (name, text) in ds.runtime.chunks {
        out.push_str(&format!(
            "<script type=\"text/plain\" data-chunk=\"{name}\">{text}</script>"
        ));
    }
    out.push_str(&format!("<script>{}</script>", ds.runtime.binder));
    Some(out)
}

/// The standalone copy of `source`, or why there is none. Every page compiles Tailwind's utilities,
/// so every ordinary page gets one (#6077). A page that pins a design system carries its verified
/// bundle, read from `releases` for a space system.
#[must_use]
pub fn derive(source: &str, assets: &Assets, releases: &dyn Releases) -> Option<Derived> {
    let skipped = |reason| {
        Some(Derived {
            outcome: Outcome {
                included: false,
                reason: Some(reason),
            },
            file: None,
        })
    };
    let (wants_react, marked) = match (wants_react(source), has_marker(source)) {
        (Ok(react), Ok(marked)) => (react, marked),
        _ => return skipped(TOO_DEEP),
    };
    let wants_design = uses_design(source);
    let named_design = match page_check::named_design(source) {
        Ok(named) => named,
        Err(page_check::TooDeep) => return skipped(TOO_DEEP),
    };
    // Every page compiles Tailwind's utilities (#6077): a React page carries all of the runtime,
    // any other page the base. A pinned design system brings every chunk, which serves both.
    let runtime = if wants_react {
        assets.runtime
    } else {
        assets.base
    };
    if !named_design && runtime.is_none() {
        return skipped(NO_RUNTIME);
    }
    if wants_design && assets.design.is_none() {
        return skipped(NO_DESIGN);
    }
    let design_system = if named_design {
        let content = match page_check::design_pin(source) {
            Ok(content) => content.unwrap_or_default(),
            Err(page_check::TooDeep) => return skipped(TOO_DEEP),
        };
        let Some(pin) = parse_pin(&content) else {
            return skipped(DESIGN_UNKNOWN_RELEASE);
        };
        let bundle = match pinned_bundle(&pin, releases) {
            Ok(bundle) => bundle,
            Err(reason) => return skipped(reason),
        };
        let Some(runtime) = assets.standalone else {
            return skipped(NO_RUNTIME);
        };
        let (Some(version), Some(hash), Ok(text)) = (
            bundle["version"].as_str(),
            bundle["hash"].as_str(),
            serde_json::to_string(&bundle),
        ) else {
            return skipped(DESIGN_UNKNOWN_RELEASE);
        };
        Some(DesignSystem {
            pin: match pin.lock {
                Some((version, hash)) => format!("{}@{version}#{hash}", pin.system),
                None => pin.system.to_owned(),
            },
            lock: format!("{version}#{hash}"),
            bundle: text,
            prose: !marked,
            runtime,
        })
    } else {
        None
    };
    let needed = Assets {
        runtime,
        base: None,
        design: assets.design.filter(|_| wants_design),
        standalone: None,
    };
    match document_with(source, &needed, design_system.as_ref()) {
        Ok(file) => Some(Derived {
            outcome: Outcome {
                included: true,
                reason: None,
            },
            file: Some(file),
        }),
        Err(reason) => skipped(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OPTED_IN: &str = r#"<meta name="tmt-colab-runtime" content="react"><p>λ</p>"#;
    const RUNTIME: Runtime = Runtime {
        script: "window.tmt={};",
        style: "@theme inline{}",
    };
    const DESIGN: Design = Design {
        script: "window.ui={};",
        style: "@layer tmt-ui{}",
    };
    const DESIGN_PAGE: &str = r#"<section class="tmt-ui-card">λ</section>"#;
    const RUNTIME_ONLY: Assets = Assets {
        runtime: Some(RUNTIME),
        base: None,
        design: None,
        standalone: None,
    };
    const DESIGN_ONLY: Assets = Assets {
        runtime: None,
        base: None,
        design: Some(DESIGN),
        standalone: None,
    };
    const BASE: Runtime = Runtime {
        script: "window.base={};",
        style: "@layer theme, base, components, utilities;@theme inline{}",
    };
    const BASE_ONLY: Assets = Assets {
        runtime: None,
        base: Some(BASE),
        design: None,
        standalone: None,
    };
    const BOTH: Assets = Assets {
        runtime: Some(RUNTIME),
        base: None,
        design: Some(DESIGN),
        standalone: None,
    };

    const CHUNKS: [(&str, &str); 2] = [("base", "window.tmt={};"), ("ui", "window.ui={};")];
    const PINNED: Standalone = Standalone {
        theme: "@theme inline{}",
        binder: "window.bind={};",
        chunks: &CHUNKS,
    };
    const PINNED_ONLY: Assets = Assets {
        runtime: Some(RUNTIME),
        base: None,
        design: Some(DESIGN),
        standalone: Some(PINNED),
    };

    /// A space system's releases, by version.
    struct Space(Vec<Value>);
    impl Releases for Space {
        fn release(&self, system: &str, version: &str, _: &str) -> Option<Value> {
            (system == "space-system")
                .then(|| {
                    self.0
                        .iter()
                        .find(|bundle| bundle["version"] == version)
                        .cloned()
                })
                .flatten()
        }
    }

    #[test]
    fn a_pinned_design_system_carries_its_verified_bundle_or_names_why_not() {
        let built_in: Value = serde_json::from_str(BUILT_IN_BUNDLE).unwrap();
        let version = built_in["version"].as_str().unwrap();
        let hash = built_in["hash"].as_str().unwrap();
        let page = |pin: &str| {
            format!("<meta name=\"tmt-ds\" content=\" {pin} \"><tmt-ui-badge>λ</tmt-ui-badge>")
        };
        // Following the built-in system, or locking its release, carries the shipped bundle as the
        // app writes it: `JSON.stringify` of the parsed bundle, which `bundle_hash` already matches.
        for pin in ["tmt-gui".to_owned(), format!("tmt-gui@{version}#{hash}")] {
            let copy = derive(&page(&pin), &PINNED_ONLY, &NoReleases).unwrap();
            assert_eq!(
                copy.outcome,
                Outcome {
                    included: true,
                    reason: None
                },
                "{pin}"
            );
            let file = String::from_utf8(copy.file.unwrap()).unwrap();
            let text = serde_json::to_string(&built_in)
                .unwrap()
                .replace('<', "\\u003c");
            assert!(file.contains(&format!(
                "<script type=\"application/json\" id=\"tmt-ds-bundle\" data-pin=\"{pin}\" data-lock=\"{version}#{hash}\" data-prose>{text}</script>"
            )), "{pin}");
            assert!(file.contains("<script type=\"text/plain\" data-chunk=\"ui\">window.ui={};</script><script>window.bind={};</script></head>"));
            assert!(
                !file.contains("<script>window.tmt={};</script>"),
                "no runtime script of its own"
            );
        }
        // A page that asks for the runtime too keeps its theme and gets no editorial ramp.
        let both = format!(
            "<meta name=\"tmt-colab-runtime\" content=\"react\">{}",
            page("tmt-gui")
        );
        let file = derive(&both, &PINNED_ONLY, &NoReleases)
            .unwrap()
            .file
            .unwrap();
        assert!(!String::from_utf8(file).unwrap().contains(" data-prose"));
        let zeros = format!("sha256-{}", "0".repeat(64));
        let reason = |source: &str, releases: &dyn Releases| {
            derive(source, &PINNED_ONLY, releases)
                .unwrap()
                .outcome
                .reason
        };
        assert_eq!(
            reason(&page(&format!("tmt-gui@{version}#{zeros}")), &NoReleases),
            Some(DESIGN_HASH_MISMATCH)
        );
        assert_eq!(
            reason(&page(&format!("tmt-gui@9.9.9#{hash}")), &NoReleases),
            Some(DESIGN_UNKNOWN_RELEASE)
        );
        assert_eq!(
            reason(&page("tmt-gui@1.0"), &NoReleases),
            Some(DESIGN_UNKNOWN_RELEASE)
        );
        assert_eq!(
            reason(&page("not a pin"), &NoReleases),
            Some(DESIGN_UNKNOWN_RELEASE)
        );
        // A space system: its draft only the browser compiles; a lock needs its release's bytes.
        assert_eq!(
            reason(&page("space-system"), &NoReleases),
            Some(DESIGN_DRAFT_UNAVAILABLE)
        );
        let mut release = built_in.clone();
        release["system"] = Value::from("space-system");
        release["version"] = Value::from("1.2.3");
        release.as_object_mut().unwrap().shift_remove("hash");
        let own = crate::design_bundle::bundle_hash(&release).unwrap();
        release["hash"] = Value::from(own.clone());
        let locked = page(&format!("space-system@1.2.3#{own}"));
        assert_eq!(
            reason(&locked, &NoReleases),
            Some(DESIGN_RELEASE_UNAVAILABLE)
        );
        assert!(
            derive(&locked, &PINNED_ONLY, &Space(vec![release.clone()]))
                .unwrap()
                .outcome
                .included
        );
        let mut edited = release.clone();
        edited["name"] = Value::from("Someone else");
        assert_eq!(
            reason(&locked, &Space(vec![edited])),
            Some(DESIGN_HASH_MISMATCH)
        );
        let mut newer = release;
        newer["runtime"] = Value::from("9");
        newer.as_object_mut().unwrap().shift_remove("hash");
        let newer_hash = crate::design_bundle::bundle_hash(&newer).unwrap();
        newer["hash"] = Value::from(newer_hash.clone());
        assert_eq!(
            reason(
                &page(&format!("space-system@1.2.3#{newer_hash}")),
                &Space(vec![newer])
            ),
            Some(DESIGN_NEWER_RUNTIME)
        );
        // Without the build's pinned runtime and binder there is no copy.
        assert_eq!(
            derive(&page("tmt-gui"), &BOTH, &NoReleases)
                .unwrap()
                .outcome
                .reason,
            Some(NO_RUNTIME)
        );
        // A pin only in a comment is no pin: the page is an ordinary one, which needs the base.
        assert_eq!(
            derive(
                "<!-- <meta name=\"tmt-ds\"> -->",
                &Assets::default(),
                &NoReleases
            )
            .unwrap()
            .outcome
            .reason,
            Some(NO_RUNTIME)
        );
    }

    #[test]
    fn the_shared_marker_vectors_decide_who_gets_react() {
        let vectors: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../contracts/vectors/runtime-marker-v1.json"
        ))
        .unwrap();
        let cases = vectors["cases"].as_array().unwrap();
        assert!(cases.len() >= 29);
        for case in cases {
            assert_eq!(
                wants_react(case["source"].as_str().unwrap()),
                Ok(case["wantsReact"].as_bool().unwrap()),
                "{}",
                case["name"]
            );
        }
    }

    #[test]
    fn a_marker_in_markup_that_a_document_parse_hides_still_follows_the_browser() {
        // <noscript> content is markup with scripting off, as in DOMParser; a <template>'s content
        // is a separate fragment that querySelector does not enter.
        let yes = |source: &str| wants_react(source) == Ok(true);
        assert!(yes(
            r#"<noscript><meta name="tmt-colab-runtime" content="react"></noscript>"#
        ));
        assert!(!yes(
            r#"<template><meta name="tmt-colab-runtime" content="react"></template>"#
        ));
        // A table foster-parents the meta out before the table; it is still the first element.
        assert!(yes(
            r#"<table><meta name="tmt-colab-runtime" content="react"></table>"#
        ));
    }

    #[test]
    fn a_source_nested_past_the_parse_depth_cannot_be_judged_but_costs_nothing_without_the_marker()
    {
        let deep = "<div>".repeat(crate::limits::PAGE_DEPTH + 50);
        assert_eq!(wants_react(&deep), Ok(false));
        let marked = format!("{OPTED_IN}{deep}");
        assert_eq!(wants_react(&marked), Err(page_check::TooDeep));
        let derived = derive(&marked, &BOTH, &NoReleases).unwrap();
        assert_eq!(derived.outcome.reason, Some(TOO_DEEP));
        assert!(derived.file.is_none());
    }

    #[test]
    fn the_meta_policy_is_the_frames_policy_without_what_a_meta_cannot_carry() {
        let policy = meta_policy();
        assert!(!policy.contains("sandbox"));
        assert_eq!(format!("{policy}; sandbox allow-scripts"), RENDERER_POLICY);
        for directive in [
            "default-src 'none'",
            "connect-src 'none'",
            "frame-src 'none'",
        ] {
            assert!(policy.contains(directive), "{directive}");
        }
    }

    #[test]
    fn the_document_is_the_frames_document_with_the_runtime_in_its_head() {
        let file = String::from_utf8(document(OPTED_IN, &RUNTIME_ONLY).unwrap()).unwrap();
        assert_eq!(
            file,
            format!(
                "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"{}\"><meta charset=\"utf-8\"><style type=\"text/tailwindcss\">@theme inline{{}}</style><script>{THEME_SWITCH}</script><script>window.tmt={{}};</script></head><body>{OPTED_IN}</body></html>",
                meta_policy()
            )
        );
    }

    #[test]
    fn a_text_that_could_leave_its_element_is_refused_with_the_reason_of_its_part() {
        for (script, style) in [
            ("a</script><b>", ""),
            ("a</SCRIPT >", ""),
            ("<!-- a", ""),
            ("", "a</style>"),
            ("", "a</STYLE >"),
            ("", "<!-- a"),
        ] {
            let runtime = Assets {
                runtime: Some(Runtime { script, style }),
                base: None,
                design: None,
                standalone: None,
            };
            assert_eq!(document(OPTED_IN, &runtime), Err(UNUSABLE));
            let design = Assets {
                runtime: None,
                base: None,
                design: Some(Design { script, style }),
                standalone: None,
            };
            assert_eq!(document(DESIGN_PAGE, &design), Err(DESIGN_UNUSABLE));
        }
    }

    #[test]
    fn every_page_gets_a_copy_with_the_runtime_it_needs_or_a_reason() {
        // A page that does not ask for React carries the base alone and the utilities-only theme
        // (#6077); the base and the whole runtime are separate assets.
        let plain = "<p class=\"p-4\">plain</p>";
        let copy = derive(plain, &BASE_ONLY, &NoReleases).unwrap();
        assert_eq!(
            copy.file,
            document(
                plain,
                &Assets {
                    runtime: Some(BASE),
                    ..Assets::default()
                }
            )
            .ok()
        );
        let file = String::from_utf8(copy.file.unwrap()).unwrap();
        assert!(file.contains("<style type=\"text/tailwindcss\">@layer theme, base, components, utilities;@theme inline{}</style>"));
        assert!(file.contains("<script>window.base={};</script>"));
        let tailwind = r#"<meta name="tmt-colab-runtime" content="tailwind"><p>λ</p>"#;
        assert!(
            String::from_utf8(
                derive(tailwind, &BASE_ONLY, &NoReleases)
                    .unwrap()
                    .file
                    .unwrap()
            )
            .unwrap()
            .contains("<script>window.base={};</script>")
        );
        assert_eq!(
            derive(plain, &BOTH, &NoReleases).unwrap().outcome.reason,
            Some(NO_RUNTIME)
        );
        assert_eq!(
            derive(OPTED_IN, &BASE_ONLY, &NoReleases)
                .unwrap()
                .outcome
                .reason,
            Some(NO_RUNTIME)
        );
        let none = derive(OPTED_IN, &Assets::default(), &NoReleases).unwrap();
        assert_eq!(
            none.outcome,
            Outcome {
                included: false,
                reason: Some(NO_RUNTIME)
            }
        );
        assert!(none.file.is_none());
        let bad = derive(
            OPTED_IN,
            &Assets {
                runtime: Some(Runtime {
                    script: "</script>",
                    style: "",
                }),
                base: None,
                design: None,
                standalone: None,
            },
            &NoReleases,
        )
        .unwrap();
        assert_eq!(bad.outcome.reason, Some(UNUSABLE));
        let made = derive(OPTED_IN, &RUNTIME_ONLY, &NoReleases).unwrap();
        assert_eq!(
            made.outcome,
            Outcome {
                included: true,
                reason: None
            }
        );
        assert_eq!(made.file, document(OPTED_IN, &RUNTIME_ONLY).ok());
    }

    #[test]
    fn the_shared_design_marker_vectors_decide_the_use() {
        let vectors: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../contracts/vectors/design-marker-v1.json"
        ))
        .unwrap();
        let cases = vectors["cases"].as_array().unwrap();
        assert!(cases.len() >= 20);
        for case in cases {
            assert_eq!(
                uses_design(case["source"].as_str().unwrap()),
                case["usesDesign"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
        }
    }

    #[test]
    fn the_design_system_is_written_before_the_runtime_and_the_attribute_marks_the_root() {
        let both = String::from_utf8(document(OPTED_IN, &BOTH).unwrap()).unwrap();
        let at = |needle: &str| both.find(needle).unwrap_or_else(|| panic!("{needle}"));
        assert!(both.starts_with("<!doctype html><html data-colab-design><head>"));
        // The frame carries the design style, then the runtime's theme; the design script comes
        // before the runtime's.
        assert!(at("<style>@layer tmt-ui{}</style>") < at("<style type=\"text/tailwindcss\">"));
        assert!(at("<script>window.ui={};</script>") < at("<script>window.tmt={};</script>"));
        assert!(at(THEME_SWITCH) < at("<script>window.ui={};</script>"));
        let alone = String::from_utf8(document(DESIGN_PAGE, &DESIGN_ONLY).unwrap()).unwrap();
        assert!(!alone.contains("tailwindcss") && !alone.contains("window.tmt"));
        let runtime = String::from_utf8(document(OPTED_IN, &RUNTIME_ONLY).unwrap()).unwrap();
        assert!(runtime.starts_with("<!doctype html><html><head>"));
        assert!(!runtime.contains("data-colab-design") && !runtime.contains("window.ui"));
    }

    #[test]
    fn only_what_a_page_asks_for_is_written_and_a_missing_part_is_named() {
        // The React page is not given the design system, and the design page gets the runtime's
        // base, not React (#6077).
        let all = Assets {
            base: Some(BASE),
            ..BOTH
        };
        let runtime = derive(OPTED_IN, &all, &NoReleases).unwrap();
        assert_eq!(runtime.file, document(OPTED_IN, &RUNTIME_ONLY).ok());
        let design = derive(DESIGN_PAGE, &all, &NoReleases).unwrap();
        assert_eq!(
            design.file,
            document(
                DESIGN_PAGE,
                &Assets {
                    runtime: Some(BASE),
                    ..DESIGN_ONLY
                }
            )
            .ok()
        );
        // A page that asks for both gets both, or the reason of the first part the build lacks.
        let source = format!("{OPTED_IN}{DESIGN_PAGE}");
        assert_eq!(
            derive(&source, &BOTH, &NoReleases).unwrap().file,
            document(&source, &BOTH).ok()
        );
        assert_eq!(
            derive(&source, &DESIGN_ONLY, &NoReleases)
                .unwrap()
                .outcome
                .reason,
            Some(NO_RUNTIME)
        );
        assert_eq!(
            derive(&source, &RUNTIME_ONLY, &NoReleases)
                .unwrap()
                .outcome
                .reason,
            Some(NO_DESIGN)
        );
        assert_eq!(
            derive(DESIGN_PAGE, &BASE_ONLY, &NoReleases)
                .unwrap()
                .outcome
                .reason,
            Some(NO_DESIGN)
        );
        for reason in [NO_RUNTIME, NO_DESIGN, UNUSABLE, DESIGN_UNUSABLE, TOO_DEEP] {
            assert_ne!(explanation(reason), "unknown reason", "{reason}");
        }
    }
}
