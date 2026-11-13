//! Immutable embedded or local-build app bytes. Requests never reach the filesystem.
use crate::{Result, app_inventory, limits};
use nix::{
    fcntl::{OFlag, open, openat},
    sys::stat::Mode,
};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Read,
    path::Path,
    sync::LazyLock,
};

pub const DEFAULT_DIRECTORY: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../../typescript/app/dist");
pub const BUILD_HINT: &str =
    "Build the app: corepack pnpm --dir typescript --filter @tmt/colab-app build";
/// Trusted chrome admits only build-owned scripts and styles.
pub use crate::browser_policy::POLICY;

/// The renderer is opaque even when opened directly rather than in an iframe.
pub use crate::browser_policy::RENDERER_POLICY;

/// Public static bytes an unpaired browser may fetch: the read-only reader entry (served at
/// `/read`, which keeps the entry's relative `./assets/` references under the mount), the files it
/// loads, the opaque renderer, the guidance script and the page runtime a reader's page may opt
/// into (#1693). Owner app files stay owner-only. The names are fixed by the `reader`, `recovery`
/// and `runtime` build modes, so this allowlist is exact; a runtime chunk (#6085) is public by its
/// vector name and content hash.
pub const READER_ROUTE: &str = "/read";
pub fn anonymous_file(path: &str) -> Option<&str> {
    if is_runtime_chunk(path) {
        return Some(path);
    }
    Some(match path {
        READER_ROUTE => "/reader.html",
        "/renderer.html" => "/renderer.html",
        "/assets/reader.js" => "/assets/reader.js",
        "/assets/reader.css" => "/assets/reader.css",
        "/assets/reader-fold.js" => "/assets/reader-fold.js",
        "/assets/recovery.js" => "/assets/recovery.js",
        "/assets/colab-runtime.css" => "/assets/colab-runtime.css",
        "/assets/chrome.css" => "/assets/chrome.css",
        _ => return None,
    })
}

/// The page runtime's chunks (#6085) that ship bytes, in load order, from the versioned vector the
/// app build shares.
static RUNTIME_CHUNKS: LazyLock<Vec<String>> = LazyLock::new(|| {
    let vector: serde_json::Value = serde_json::from_str(include_str!(
        "../../../contracts/vectors/page-runtime-chunks-v1.json"
    ))
    .expect("the page runtime chunk vector is JSON");
    vector["chunks"]
        .as_array()
        .expect("the vector lists chunks")
        .iter()
        .filter(|chunk| chunk["reserved"] != true && chunk["kind"] != "wasm")
        .map(|chunk| {
            chunk["name"]
                .as_str()
                .expect("a chunk has a name")
                .to_owned()
        })
        .collect()
});
pub fn runtime_chunk_names() -> &'static [String] {
    &RUNTIME_CHUNKS
}

/// The vector chunk a path names: `/assets/colab-runtime-<name>-<16 lowercase hex>.js`.
fn runtime_chunk(path: &str) -> Option<&'static str> {
    let stem = path
        .strip_prefix("/assets/colab-runtime-")?
        .strip_suffix(".js")?;
    let (name, hash) = stem.rsplit_once('-')?;
    if hash.len() != 16 || !hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return None;
    }
    RUNTIME_CHUNKS
        .iter()
        .find(|chunk| *chunk == name)
        .map(String::as_str)
}
/// Whether a path is a runtime chunk. Its name carries its content hash, so it never changes.
#[must_use]
pub fn is_runtime_chunk(path: &str) -> bool {
    runtime_chunk(path).is_some() || app_inventory::is_terminal_wasm(path)
}

/// The seal the renderer runs after the chunks; a copy that inlines them runs it the same way.
pub const RUNTIME_SEAL: &str = "window.__colabRuntimeSeal?.();";

#[derive(Debug)]
pub struct AssetFault(String);
impl std::fmt::Display for AssetFault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Colab app build is unavailable: {}. {BUILD_HINT}",
            self.0
        )
    }
}
impl std::error::Error for AssetFault {}

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/colab_assets.rs"));
}

struct Asset {
    content_type: &'static str,
    bytes: Vec<u8>,
}
pub struct App {
    files: BTreeMap<String, Asset>,
}
impl App {
    /// Explicit builds fail closed; embedded bytes precede local checkout output.
    pub fn selected(explicit: Option<&Path>) -> Result<Option<Self>> {
        Self::selected_from(explicit, embedded::ASSETS, Path::new(DEFAULT_DIRECTORY))
    }
    fn selected_from(
        explicit: Option<&Path>,
        embedded: &[(&str, &[u8])],
        default: &Path,
    ) -> Result<Option<Self>> {
        if let Some(directory) = explicit {
            return Self::load(directory)
                .map(Some)
                .map_err(|error| AssetFault(format!("{}: {error}", directory.display())).into());
        }
        if !embedded.is_empty() {
            return Self::from_embedded(embedded)
                .map(Some)
                .map_err(|error| AssetFault(format!("embedded inventory: {error}")).into());
        }
        Ok(Self::load(default).ok())
    }
    fn from_embedded(files: &[(&str, &[u8])]) -> Result<Self> {
        app_inventory::validate(files)?;
        Ok(Self {
            files: files
                .iter()
                .map(|&(route, bytes)| {
                    (
                        route.to_owned(),
                        Asset {
                            content_type: app_inventory::content_type(route)
                                .expect("validated route"),
                            bytes: bytes.to_vec(),
                        },
                    )
                })
                .collect(),
        })
    }
    pub fn load(directory: &Path) -> Result<Self> {
        if !directory.is_absolute() || !fs::symlink_metadata(directory)?.is_dir() {
            return Err("App directory must be an absolute, real directory.".into());
        }
        let directory = directory.canonicalize()?;
        let flags = OFlag::O_RDONLY | OFlag::O_NOFOLLOW | OFlag::O_NONBLOCK;
        let root = File::from(open(&directory, flags | OFlag::O_DIRECTORY, Mode::empty())?);
        let assets = File::from(openat(
            &root,
            "assets",
            flags | OFlag::O_DIRECTORY,
            Mode::empty(),
        )?);
        let mut app = Self {
            files: BTreeMap::new(),
        };
        let mut total = 0;
        for entry in fs::read_dir(&directory)? {
            let name = entry?.file_name();
            if name == "assets" {
                continue;
            }
            let name = name.to_str().ok_or("App filename must be UTF-8.")?;
            app.insert(&root, name, format!("/{name}"), &mut total)?;
        }
        // Names come from enumeration; all opens stay anchored to the admitted
        // directory handles, including if a build replaces a directory meanwhile.
        for entry in fs::read_dir(directory.join("assets"))? {
            let name = entry?.file_name();
            let name = name.to_str().ok_or("App filename must be UTF-8.")?;
            app.insert(&assets, name, format!("/assets/{name}"), &mut total)?;
        }
        app_inventory::validate(
            &app.files
                .iter()
                .map(|(route, asset)| (route.as_str(), asset.bytes.as_slice()))
                .collect::<Vec<_>>(),
        )?;
        Ok(app)
    }
    fn insert(
        &mut self,
        directory: &File,
        name: &str,
        route: String,
        total: &mut usize,
    ) -> Result<()> {
        if self.files.len() >= limits::APP_FILES {
            return Err("App has too many assets.".into());
        }
        let content_type =
            app_inventory::content_type(&route).ok_or("Unsupported app asset type.")?;
        let file = File::from(openat(
            directory,
            name,
            OFlag::O_RDONLY | OFlag::O_NOFOLLOW | OFlag::O_NONBLOCK,
            Mode::empty(),
        )?);
        let metadata = file.metadata()?;
        let remaining = limits::APP_BYTES - *total;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > remaining as u64 {
            return Err("App assets must be nonempty bounded regular files.".into());
        }
        let mut bytes = Vec::new();
        file.take(remaining as u64 + 1).read_to_end(&mut bytes)?;
        if bytes.is_empty() || bytes.len() > remaining {
            return Err("App exceeds its byte budget.".into());
        }
        *total += bytes.len();
        self.files.insert(
            route,
            Asset {
                content_type,
                bytes,
            },
        );
        Ok(())
    }
    pub fn find(&self, path: &str) -> Option<(&'static str, &[u8])> {
        let path = if path == "/" { "/index.html" } else { path };
        self.files
            .get(path)
            .map(|asset| (asset.content_type, asset.bytes.as_slice()))
    }
    /// Every runtime chunk in load order, then the seal, as one script: what a standalone copy
    /// inlines. Absent unless the build has exactly one file for each chunk.
    #[must_use]
    pub fn runtime_script(&self) -> Option<String> {
        let mut script = String::new();
        for name in RUNTIME_CHUNKS.iter() {
            let mut files = self
                .files
                .iter()
                .filter(|(path, _)| runtime_chunk(path) == Some(name.as_str()));
            let (_, asset) = files.next()?;
            if files.next().is_some() {
                return None;
            }
            script.push_str(std::str::from_utf8(&asset.bytes).ok()?);
            script.push('\n');
        }
        script.push_str(RUNTIME_SEAL);
        Some(script)
    }

    /// The runtime's base alone, then the seal: what a copy of a page that does not ask for React
    /// carries (#6077), the Tailwind compiler with no React.
    pub fn base_script(&self) -> Option<String> {
        let base = RUNTIME_CHUNKS.first()?;
        let mut files = self
            .files
            .iter()
            .filter(|(path, _)| runtime_chunk(path) == Some(base.as_str()));
        let (_, asset) = files.next()?;
        if files.next().is_some() {
            return None;
        }
        Some(format!(
            "{}\n{RUNTIME_SEAL}",
            std::str::from_utf8(&asset.bytes).ok()?
        ))
    }

    /// What a standalone copy of a page that pins a design system carries (#6157): the runtime
    /// theme, the binder, and each chunk's text by name in load order. Each is exactly the file
    /// `runtime-pin.json` records, so the binder's own chunk hashes hold; `None` when one is missing
    /// or differs.
    pub fn standalone_runtime(&self) -> Option<StandaloneRuntime<'_>> {
        use sha2::Digest;
        let pinned = |file: &serde_json::Value| -> Option<&str> {
            let path = format!("/{}", file["path"].as_str()?);
            let (_, bytes) = self.find(&path)?;
            let digest = sha2::Sha256::digest(bytes)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            (file["sha256"] == digest.as_str() && file["length"] == bytes.len())
                .then(|| std::str::from_utf8(bytes).ok())
                .flatten()
        };
        let pin = &*RUNTIME_PIN;
        let chunks = RUNTIME_CHUNKS
            .iter()
            .map(|name| {
                let file = pin["chunks"]
                    .as_array()?
                    .iter()
                    .find(|chunk| chunk["name"] == name.as_str())?;
                Some((name.as_str(), pinned(file)?))
            })
            .collect::<Option<Vec<_>>>()?;
        Some(StandaloneRuntime {
            theme: pinned(&pin["theme"])?,
            binder: pinned(&pin["binder"])?,
            chunks,
        })
    }
}

/// The build's pinned runtime files, as `App::standalone_runtime` returns them.
pub struct StandaloneRuntime<'a> {
    pub theme: &'a str,
    pub binder: &'a str,
    pub chunks: Vec<(&'static str, &'a str)>,
}

/// The reviewed runtime pin this executable was built with (`scripts/verify-runtime.mjs`).
static RUNTIME_PIN: LazyLock<serde_json::Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../typescript/app/runtime-pin.json"))
        .expect("the runtime pin is JSON")
});
#[cfg(test)]
#[path = "assets_tests.rs"]
mod tests;
