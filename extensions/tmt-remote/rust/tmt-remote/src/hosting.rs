//! Pure static-manifest validation and Hosting composition over captured file identities.
//! No file, process, provider or credential access; public bytes grant no authority.
use crate::{canonical, deploy_plan::sha256_hex, limits};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::PathBuf};

const DECLARATION_PREFIX: &str = "/tmt/declarations";

pub fn site_id_ok(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= limits::HOSTING_SITE_ID_BYTES
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}
pub fn app_id_ok(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= limits::HOSTING_WEB_APP_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_:-".contains(&byte))
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostingManifest {
    pub version: u8,
    pub files: Vec<HostingFile>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostingFile {
    pub path: String,
    pub sha256: String,
    pub length: u64,
    pub content_type: String,
    #[serde(
        default,
        deserialize_with = "optional_csp",
        skip_serializing_if = "Option::is_none"
    )]
    pub csp: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub immutable: bool,
}
fn is_false(value: &bool) -> bool {
    !*value
}
fn immutable_path(path: &str, sha256: &str) -> bool {
    path.strip_prefix("/assets/")
        .and_then(|asset| asset.rsplit('/').next())
        .and_then(|name| name.rsplit_once('.'))
        .and_then(|(stem, _)| stem.rsplit_once('-'))
        .is_some_and(|(_, segment)| {
            segment.len() == 16
                && segment
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                && sha256.starts_with(segment)
        })
}
fn optional_csp<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostingRefusal {
    Shape,
    Bounds,
    Path,
    Reserved,
    Digest,
    ContentType,
    Csp,
    FileSet,
    Collision,
    Entry,
    Inventory,
    WebAppSelection,
    Compression,
}
impl HostingManifest {
    pub fn parse(value: &Value) -> Result<Self, HostingRefusal> {
        let manifest: Self =
            serde_json::from_value(value.clone()).map_err(|_| HostingRefusal::Shape)?;
        if manifest.version != 1 || manifest.files.is_empty() {
            return Err(HostingRefusal::Shape);
        }
        let mut previous: Option<&str> = None;
        for file in &manifest.files {
            if !path_ok(&file.path) {
                return Err(HostingRefusal::Path);
            }
            if crate::invite_page::reserved(&file.path)
                || file.path == "/__"
                || file.path.starts_with("/__/")
                || file
                    .path
                    .strip_prefix(DECLARATION_PREFIX)
                    .is_some_and(|suffix| suffix.is_empty() || suffix.starts_with('/'))
            {
                return Err(HostingRefusal::Reserved);
            }
            if previous.is_some_and(|path| path >= file.path.as_str()) {
                return Err(HostingRefusal::Collision);
            }
            previous = Some(&file.path);
            if !digest_ok(&file.sha256) {
                return Err(HostingRefusal::Digest);
            }
            if !content_type_ok(&file.content_type) {
                return Err(HostingRefusal::ContentType);
            }
            if file.csp.as_ref().is_some_and(|csp| {
                csp.is_empty()
                    || csp.len() > limits::HOSTING_CSP_BYTES
                    || !csp.bytes().all(|byte| (0x20..=0x7e).contains(&byte))
            }) {
                return Err(HostingRefusal::Csp);
            }
        }
        Ok(manifest)
    }
    /// Canonical manifest identity, independent of declaration whitespace.
    pub fn digest(&self) -> String {
        sha256_hex(&serde_json::to_vec(self).expect("manifest serializes"))
    }
}
pub(crate) fn path_ok(path: &str) -> bool {
    path.starts_with('/')
        && path.len() <= limits::HOSTING_PATH_BYTES
        && path[1..].split('/').all(|part| {
            !part.is_empty()
                && !part.starts_with('.')
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        })
}
fn digest_ok(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}
fn content_type_ok(value: &str) -> bool {
    matches!(
        value,
        "text/html"
            | "text/plain"
            | "text/css"
            | "text/javascript"
            | "application/javascript"
            | "application/json"
            | "application/wasm"
            | "image/svg+xml"
            | "image/png"
            | "image/jpeg"
            | "image/webp"
            | "image/x-icon"
            | "font/woff"
            | "font/woff2"
    )
}

pub(crate) fn response_headers(file: &HostingFile) -> Value {
    let content_type = if matches!(
        file.content_type.as_str(),
        "text/html"
            | "text/css"
            | "text/javascript"
            | "application/javascript"
            | "application/json"
            | "text/plain"
    ) {
        format!("{}; charset=utf-8", file.content_type)
    } else {
        file.content_type.clone()
    };
    let mut headers = json!({"Content-Type":content_type,"X-Content-Type-Options":"nosniff",
        "Cache-Control":"no-cache","Referrer-Policy":"no-referrer"});
    if let Some(csp) = &file.csp {
        headers["Content-Security-Policy"] = json!(csp);
    }
    if file.immutable && immutable_path(&file.path, &file.sha256) {
        headers["Cache-Control"] = json!("public, max-age=31536000, immutable");
    }
    if crate::invite_page::reserved(&file.path) {
        headers["Cache-Control"] = json!("no-store");
    }
    headers
}
const SHORT_ROUTES: [&str; 3] = ["^/colab/?$", "^/(p|read)/[A-Za-z0-9_-]{4,64}$", "^/pair$"];

/// An absolute source coordinate is private acquisition metadata, excluded from content identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostingFileReference {
    pub path: PathBuf,
    pub length: u64,
    pub sha256: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostingGzip {
    pub sha256: String,
    pub length: usize,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostingSource {
    pub file: HostingFileReference,
    pub gzip: HostingGzip,
}
/// Metadata for files already verified by the native acquisition owner.
pub struct HostingBundle {
    manifest: HostingManifest,
    files: BTreeMap<String, HostingSource>,
}
impl HostingBundle {
    pub fn from_sources(
        manifest: &HostingManifest,
        files: BTreeMap<String, HostingSource>,
    ) -> Result<Self, HostingRefusal> {
        HostingManifest::parse(
            &serde_json::to_value(manifest).map_err(|_| HostingRefusal::Shape)?,
        )?;
        if files.len() != manifest.files.len() {
            return Err(HostingRefusal::FileSet);
        }
        for expected in &manifest.files {
            let source = files.get(&expected.path).ok_or(HostingRefusal::FileSet)?;
            validate_source(expected, source)?;
        }
        Ok(Self {
            manifest: manifest.clone(),
            files,
        })
    }
}
fn validate_source(file: &HostingFile, source: &HostingSource) -> Result<(), HostingRefusal> {
    if !source.file.path.is_absolute() {
        return Err(HostingRefusal::Path);
    }
    if source.file.length != file.length
        || source.file.sha256 != file.sha256
        || !digest_ok(&source.gzip.sha256)
    {
        return Err(HostingRefusal::Digest);
    }
    Ok(())
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingTransportFile {
    pub path: String,
    pub raw_digest: String,
    pub raw_length: u64,
    pub gzip_digest: String,
    pub gzip_length: usize,
    pub content_type: String,
}
/// Frozen content, transport identities and REST ServingConfig, all covered by its digest.
pub struct HostingComposition {
    files: Vec<HostingTransportFile>,
    config: Value,
    sources: BTreeMap<String, HostingSource>,
    digest: String,
}
impl HostingComposition {
    pub fn files(&self) -> &[HostingTransportFile] {
        &self.files
    }
    pub fn config(&self) -> &Value {
        &self.config
    }
    pub fn digest(&self) -> &str {
        &self.digest
    }
    pub fn source(&self, path: &str) -> Option<&HostingSource> {
        self.sources.get(path)
    }
    pub fn view(&self) -> Value {
        json!({"version":1,"files":self.files,"config":self.config,"digest":self.digest})
    }
}
/// One already-admitted declaration paired with its validated bundle by discovery.
/// Declaration bytes remain opaque here; no parsing or normalization is performed.
pub struct HostingInput<'a> {
    pub extension: &'a str,
    pub declaration: &'a [u8],
    pub bundle: &'a HostingBundle,
}
/// Freeze already-paired inventories and exact declarations in the same bounded file set.
pub fn compose(
    inputs: &[HostingInput<'_>],
    mut generated: impl FnMut(&HostingFile, &[u8]) -> Result<HostingSource, HostingRefusal>,
) -> Result<Option<HostingComposition>, HostingRefusal> {
    if inputs.is_empty() {
        return Ok(None);
    }
    let declarations: Vec<_> = inputs
        .iter()
        .map(|input| {
            if !canonical::extension_name(input.extension) {
                return Err(HostingRefusal::Shape);
            }
            Ok(HostingFile {
                path: format!("{DECLARATION_PREFIX}/{}.json", input.extension),
                sha256: sha256_hex(input.declaration),
                length: input.declaration.len() as u64,
                content_type: "application/json".into(),
                csp: None,
                immutable: false,
            })
        })
        .collect::<Result<_, _>>()?;
    let mut files = BTreeMap::new();
    for (input, declaration) in inputs.iter().zip(&declarations) {
        for file in &input.bundle.manifest.files {
            if files
                .insert(
                    file.path.clone(),
                    (file, input.bundle.files[&file.path].clone()),
                )
                .is_some()
            {
                return Err(HostingRefusal::Collision);
            }
        }
        let source = generated(declaration, input.declaration)?;
        validate_source(declaration, &source)?;
        if files
            .insert(declaration.path.clone(), (declaration, source))
            .is_some()
        {
            return Err(HostingRefusal::Collision);
        }
    }
    let owned = crate::invite_page::assets();
    for (file, raw) in &owned {
        let source = generated(file, raw.as_bytes())?;
        validate_source(file, &source)?;
        if files.insert(file.path.clone(), (file, source)).is_some() {
            return Err(HostingRefusal::Collision);
        }
    }
    for path in files.keys() {
        let mut ancestor = path.as_str();
        while let Some((parent, _)) = ancestor.rsplit_once('/') {
            if files.contains_key(parent) {
                return Err(HostingRefusal::Collision);
            }
            ancestor = parent;
        }
    }
    if files
        .get("/index.html")
        .is_none_or(|(file, _)| file.content_type != "text/html")
    {
        return Err(HostingRefusal::Entry);
    }
    let shell_headers = response_headers(files["/index.html"].0);
    let mut transport = Vec::new();
    let mut sources = BTreeMap::new();
    let mut headers = Vec::new();
    for (path, (file, source)) in files {
        transport.push(HostingTransportFile {
            path: path.clone(),
            raw_digest: file.sha256.clone(),
            raw_length: file.length,
            gzip_digest: source.gzip.sha256.clone(),
            gzip_length: source.gzip.length,
            content_type: file.content_type.clone(),
        });
        headers.push(json!({"glob":path,"headers":response_headers(file)}));
        sources.insert(path, source);
    }
    // REST headers match the original request path, not the rewrite destination.
    // The short entries therefore need the shell's exact headers on their own patterns.
    for regex in std::iter::once("^/$").chain(SHORT_ROUTES) {
        headers.push(json!({"regex":regex,"headers":shell_headers}));
    }
    let mut rewrites: Vec<_> = SHORT_ROUTES
        .iter()
        .map(|regex| json!({"regex":regex,"path":"/index.html"}))
        .collect();
    headers
        .push(json!({"regex":crate::invite_page::ROUTE,"headers":response_headers(&owned[0].0)}));
    rewrites.push(json!({"regex":crate::invite_page::ROUTE,"path":"/join.html"}));
    // Only public shell routes; reserved Firebase configuration is never rewritten.
    let config = json!({"headers":headers,"rewrites":rewrites});
    if serde_json::to_vec(&config)
        .expect("config serializes")
        .len()
        > limits::HOSTING_CONFIG_BYTES
    {
        return Err(HostingRefusal::Bounds);
    }
    let digest = sha256_hex(
        &serde_json::to_vec(&json!({"files":transport,"config":config}))
            .expect("composition serializes"),
    );
    Ok(Some(HostingComposition {
        files: transport,
        config,
        sources,
        digest,
    }))
}

/// Read-only site inventory supplied by the provider edge; never a guessed empty site.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostingInventory {
    pub site_exists: bool,
    pub site_app_id: Option<String>,
    pub site_app_config: Option<Value>,
    pub web_apps: Vec<HostingWebApp>,
    pub live: Option<HostingLiveRelease>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostingLiveRelease {
    pub version: String,
    pub deployment_id: Option<String>,
    pub plan_digest_prefix: Option<String>,
    pub content_digest: Option<String>,
    pub files: Vec<HostingLiveFile>,
    pub config: Value,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostingDeploymentView {
    pub site: String,
    pub public_url: String,
    pub create_site: bool,
    pub configure_site: bool,
    pub site_app_id: Option<String>,
    pub web_app: Option<String>,
    pub create_web_app: bool,
    pub content: Value,
    /// An expired retained stage requires a new explicit whole-plan authorization.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abandoned_version: Option<String>,
    pub replaces: String,
    pub replaced_fingerprint: Option<String>,
}
/// Ownership labels plus exact content identify an own release. Labels alone never do.
/// Foreign fingerprints include the captured release identity and complete file/config set.
/// A retained app never silently changes when the provider inventory changes.
pub fn deployment_view(
    composition: &HostingComposition,
    project: &str,
    deployment_id: &str,
    inventory: &HostingInventory,
    site: &str,
    recorded_app: Option<&str>,
    create_app: bool,
) -> Result<HostingDeploymentView, HostingRefusal> {
    if !crate::deploy_run::project_ok(project)
        || crate::canonical::uuid(deployment_id).is_err()
        || inventory.web_apps.len() > limits::HOSTING_WEB_APPS
        || !site_id_ok(site)
    {
        return Err(HostingRefusal::Inventory);
    }
    let mut ids = std::collections::BTreeSet::new();
    if inventory
        .web_apps
        .iter()
        .any(|app| !app.valid() || !ids.insert(&app.id))
    {
        return Err(HostingRefusal::Inventory);
    }
    let associated = inventory.site_app_id.as_deref();
    if associated.is_some_and(|id| id.is_empty() || !inventory.site_exists)
        || recorded_app
            .zip(associated)
            .is_some_and(|(recorded, site)| recorded != site)
        || associated
            .is_some_and(|id| !public_config_ok(inventory.site_app_config.as_ref(), project, id))
        || (associated.is_none() && inventory.site_app_config.is_some())
    {
        return Err(HostingRefusal::WebAppSelection);
    }
    let selected_id = recorded_app.or(associated);
    let matching: Vec<_> = inventory
        .web_apps
        .iter()
        .filter(|app| {
            app.state == "ACTIVE"
                && selected_id.map_or_else(
                    || app.display_name == app_name(deployment_id),
                    |id| app.id == id,
                )
        })
        .collect();
    let web_app = match matching.as_slice() {
        [] if selected_id.is_none() && create_app => None,
        [only] => Some(only.id.clone()),
        _ => return Err(HostingRefusal::WebAppSelection),
    };
    let mut replaces = "none";
    let mut replaced_fingerprint = None;
    if let Some(live) = &inventory.live {
        if !inventory.site_exists
            || live.version.is_empty()
            || live.version.len() > 256
            || live.version.chars().any(char::is_control)
            || live.files.len() > limits::HOSTING_LIST_PARSE_FILES
            || serde_json::to_vec(&live.config)
                .map_err(|_| HostingRefusal::Inventory)?
                .len()
                > limits::HOSTING_CONFIG_BYTES
        {
            return Err(HostingRefusal::Inventory);
        }
        let mut files = live.files.clone();
        files.sort_by(|a, b| a.path.cmp(&b.path));
        if files.windows(2).any(|p| p[0].path == p[1].path)
            || files
                .iter()
                .any(|f| !path_ok(&f.path) || !digest_ok(&f.hash) || f.status != "ACTIVE")
        {
            return Err(HostingRefusal::Inventory);
        }
        let digest = content_digest(&files, &live.config);
        let own = live.deployment_id.as_deref() == Some(deployment_id)
            && live.content_digest.as_deref() == Some(&digest[..32])
            && live.plan_digest_prefix.as_deref().is_some_and(|p| {
                p.len() == 12 && p.bytes().all(|b| matches!(b,b'0'..=b'9'|b'a'..=b'f'))
            });
        if own {
            replaces = if digest == composition.live_digest() {
                "none"
            } else {
                "own"
            };
        } else {
            replaces = "foreign";
            let mut canonical = live.clone();
            canonical.files = files;
            replaced_fingerprint = Some(sha256_hex(
                &serde_json::to_vec(&serde_json::to_value(&canonical).expect("release serializes"))
                    .expect("release serializes"),
            ));
        }
    }
    Ok(HostingDeploymentView {
        site: site.into(),
        public_url: format!("https://{site}.web.app"),
        create_site: !inventory.site_exists,
        configure_site: associated.is_none(),
        site_app_id: inventory.site_app_id.clone(),
        create_web_app: web_app.is_none(),
        web_app,
        content: composition.view(),
        abandoned_version: None,
        replaces: replaces.into(),
        replaced_fingerprint,
    })
}

/// Fixed public Firebase config only; no provider/credential metadata is admitted.
pub(crate) fn public_config_ok(value: Option<&Value>, project: &str, app: &str) -> bool {
    value.is_some_and(|c| {
        c.as_object().is_some_and(|o| o.len() == 4)
            && c["projectId"] == project
            && c["appId"] == app
            && c["authDomain"] == format!("{project}.firebaseapp.com")
            && ["apiKey", "appId"].into_iter().all(|key| {
                c[key].as_str().is_some_and(|s| {
                    !s.is_empty() && s.len() <= 256 && s.bytes().all(|b| (0x20..=0x7e).contains(&b))
                })
            })
    })
}
/// Same-project Management API app projection, including the site's associated app.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostingWebApp {
    pub id: String,
    pub display_name: String,
    pub state: String,
}
impl HostingWebApp {
    fn valid(&self) -> bool {
        [&self.id, &self.display_name, &self.state]
            .into_iter()
            .all(|s| s.len() <= 256 && !s.chars().any(char::is_control))
            && !self.id.is_empty()
            && matches!(self.state.as_str(), "ACTIVE" | "DELETED")
    }
}
pub fn app_name(deployment_id: &str) -> String {
    format!("tmt Remote ({deployment_id})")
}
/// The actual Hosting API file projection, not invented raw-file metadata.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostingLiveFile {
    pub path: String,
    pub hash: String,
    pub status: String,
}
impl HostingComposition {
    pub fn live_files(&self) -> Vec<HostingLiveFile> {
        self.files
            .iter()
            .map(|f| HostingLiveFile {
                path: f.path.clone(),
                hash: f.gzip_digest.clone(),
                status: "ACTIVE".into(),
            })
            .collect()
    }
    pub fn live_digest(&self) -> String {
        content_digest(&self.live_files(), &self.config)
    }
}

/// Files have canonical path order; config object key order is provider-independent.
/// Rust field order deliberately differs from the old helper's sorted-key hash.
fn content_digest(files: &[HostingLiveFile], config: &Value) -> String {
    let mut config = config.clone();
    config.sort_all_objects();
    sha256_hex(
        &serde_json::to_vec(&json!({"files": files, "config": config}))
            .expect("content serializes"),
    )
}
