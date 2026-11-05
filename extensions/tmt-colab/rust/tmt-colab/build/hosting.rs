//! Build-owned plain hosted-tree admission and portable manifest metadata.
use crate::browser_policy;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};

const SDK_ROUTE: &str = "/sdk/remote-v1.js";
/// Remote's lazy Firebase client and its notices: hosted-only build output that Remote pins.
const FIREBASE_ROUTE: &str = "/sdk/remote-firebase-v1.js";
const NOTICES_ROUTE: &str = "/sdk/THIRD-PARTY-NOTICES-remote.txt";
const PIN: &str = "firebase-build-pin.json";
/// The most a declaration may be: mirrors `limits::DECLARATION_TEXT_BYTES`, which
/// `deploy-declaration` refuses above. A test equates the two.
pub const DECLARATION_TEXT_BYTES: usize = 64 * 1024;
/// What `deploy_declaration::declaration_of` inserts before the manifest, in place of the
/// closing brace's line break it removes and puts back after it.
pub const SPLICE: &str = ",\n  \"hosting\": ";
/// Each pinned Remote output: its hosted route, its path in Remote's pin manifest and the name of
/// the copy the build keeps.
const PINNED: [(&str, &str, &str); 2] = [
    (
        FIREBASE_ROUTE,
        "dist/remote-firebase-v1.js",
        "colab-remote-firebase-v1.js",
    ),
    (
        NOTICES_ROUTE,
        "dist/THIRD-PARTY-NOTICES.txt",
        "colab-remote-notices.txt",
    ),
];

#[derive(Serialize)]
struct Manifest {
    version: u8,
    files: Vec<File>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct File {
    path: String,
    sha256: String,
    length: usize,
    content_type: &'static str,
    csp: &'static str,
    #[serde(skip_serializing_if = "is_false")]
    immutable: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}
fn invalid(message: &str) -> io::Error {
    io::Error::other(message)
}
fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
pub(crate) fn verify_sdk_copy(expected_digest: &str, copied: &[u8]) -> io::Result<()> {
    if digest(copied) != expected_digest {
        return Err(invalid("Remote SDK copy digest mismatch"));
    }
    Ok(())
}
/// Remote's pin of its hosted-only build: exactly the two `PINNED` files, each with the lowercase
/// SHA-256 and length of the bytes Remote built, in `PINNED` order. A pin that names more, fewer
/// or other files means Remote's output changed shape and this copy must be reviewed.
fn pins(client: &Path) -> io::Result<Vec<(String, usize)>> {
    let malformed = || invalid("Remote's Firebase build pin is malformed");
    let value: serde_json::Value = serde_json::from_slice(&read(&client.join(PIN))?)?;
    let files = value["files"]
        .as_array()
        .filter(|files| value["version"] == 1 && files.len() == PINNED.len())
        .ok_or_else(malformed)?;
    PINNED
        .iter()
        .map(|(_, path, _)| {
            let mut named = files.iter().filter(|file| file["path"] == *path);
            let (Some(entry), None) = (named.next(), named.next()) else {
                return Err(malformed());
            };
            let sha256 = entry["sha256"]
                .as_str()
                .filter(|sha| {
                    sha.len() == 64 && sha.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
                })
                .ok_or_else(malformed)?;
            let length = entry["length"].as_u64().ok_or_else(malformed)?;
            Ok((sha256.to_owned(), length as usize))
        })
        .collect()
}
fn read(path: &Path) -> io::Result<Vec<u8>> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_file() {
        return Err(invalid("Hosted files must be regular files"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(
            meta.len()
                .checked_add(1)
                .ok_or_else(|| invalid("Hosted file length overflow"))?,
        )
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 != meta.len() {
        return Err(invalid("Hosted file changed length while reading"));
    }
    Ok(bytes)
}
fn content_type(route: &str) -> io::Result<&'static str> {
    Ok(match route.rsplit('.').next() {
        Some("html") => "text/html",
        Some("txt") => "text/plain",
        Some("css") => "text/css",
        Some("js") => "text/javascript",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        _ => return Err(invalid("Unsupported hosted content type")),
    })
}
fn collect(
    directory: &Path,
    prefix: &str,
    files: &mut Vec<(String, Vec<u8>)>,
    inputs: &mut Vec<PathBuf>,
) -> io::Result<()> {
    if !fs::symlink_metadata(directory)?.is_dir() {
        return Err(invalid("Hosted directories must be real directories"));
    }
    inputs.push(directory.to_owned());
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name
            .to_str()
            .ok_or_else(|| invalid("Hosted filename must be UTF-8"))?;
        if name.is_empty()
            || name.starts_with('.')
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        {
            return Err(invalid("Unsafe hosted filename"));
        }
        let route = format!("{prefix}/{name}");
        if route.len() > 1024 || route == "/__" || route.starts_with("/__/") {
            return Err(invalid("Hosted path is reserved or too long"));
        }
        let path = entry.path();
        if fs::symlink_metadata(&path)?.is_dir() {
            collect(&path, &route, files, inputs)?;
        } else {
            content_type(&route)?;
            files.push((route, read(&path)?));
            inputs.push(path);
        }
    }
    Ok(())
}

/// `sdk` is Remote's committed `remote-v1.js`; `client` is Remote's client directory, whose pin
/// manifest vouches for the Firebase build in its `dist`. Remote's build must have run first.
/// `declaration` is the static declaration the manifest is spliced into.
pub fn generate(
    directory: Option<&Path>,
    sdk: &Path,
    client: &Path,
    declaration: &Path,
    output: &Path,
) -> io::Result<Vec<PathBuf>> {
    let Some(directory) = directory else {
        fs::write(
            output.join("colab_hosting.rs"),
            "const MANIFEST: Option<&[u8]> = None;\n",
        )?;
        return Ok(Vec::new());
    };
    if !directory.is_absolute()
        || !sdk.is_absolute()
        || !client.is_absolute()
        || !declaration.is_absolute()
    {
        return Err(invalid("Hosted build paths must be absolute"));
    }
    let mut inputs = Vec::new();
    let mut files = Vec::new();
    collect(directory, "", &mut files, &mut inputs)?;
    for route in ["/index.html", "/THIRD-PARTY-NOTICES.txt"] {
        if !files.iter().any(|(path, _)| path == route) {
            return Err(invalid("Hosted entry or dependency notices are missing"));
        }
    }
    // The ordinary hosted frontend build materializes SDK files into dist-hosted. Native
    // compilation verifies these copies; it never copies or embeds the hosted tree.
    for (route, original) in [
        (SDK_ROUTE, sdk.to_owned()),
        (FIREBASE_ROUTE, client.join("dist/remote-firebase-v1.js")),
        (NOTICES_ROUTE, client.join("dist/THIRD-PARTY-NOTICES.txt")),
    ] {
        let source = read(&original)?;
        let copied = files
            .iter()
            .find(|(path, _)| path == route)
            .ok_or_else(|| {
                invalid("Hosted Remote SDK file is missing; build the hosted tree first")
            })?;
        verify_sdk_copy(&digest(&source), &copied.1)?;
        inputs.push(original);
    }
    for ((route, source, _), (sha256, length)) in PINNED.iter().zip(pins(client)?) {
        let copied = files
            .iter()
            .find(|(path, _)| path == route)
            .ok_or_else(|| invalid("Pinned hosted SDK file is missing"))?;
        if copied.1.len() != length
            || digest(&copied.1) != sha256
            || digest(&read(&client.join(source))?) != sha256
        {
            return Err(invalid("Remote's Firebase output does not match its pin"));
        }
    }
    inputs.push(client.join(PIN));
    files.sort_by(|a, b| a.0.cmp(&b.0));
    if files.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        return Err(invalid("Duplicate hosted path"));
    }
    let mut manifest = Manifest {
        version: 1,
        files: Vec::new(),
    };
    for (route, bytes) in files {
        let hash = digest(&bytes);
        manifest.files.push(File {
            content_type: content_type(&route)?,
            csp: if route == "/renderer.html" {
                browser_policy::RENDERER_POLICY
            } else {
                browser_policy::HOSTED_POLICY
            },
            immutable: route
                .strip_prefix("/assets/")
                .and_then(|asset| asset.rsplit('/').next())
                .and_then(|name| name.rsplit_once('.'))
                .and_then(|(stem, _)| stem.rsplit_once('-'))
                .is_some_and(|(_, segment)| {
                    segment.len() == 16
                        && segment
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                        && hash.starts_with(segment)
                }),
            path: route.clone(),
            sha256: hash,
            length: bytes.len(),
        });
    }
    let manifest_bytes = serde_json::to_vec(&manifest)?;
    // The declaration and manifest remain bounded JSON, independently of asset sizes/counts.
    let base = fs::metadata(declaration)?.len() as usize;
    if base + SPLICE.len() + manifest_bytes.len() > DECLARATION_TEXT_BYTES {
        return Err(invalid(
            "Hosted manifest would make the declaration exceed its size cap",
        ));
    }
    inputs.push(declaration.to_owned());
    fs::write(output.join("colab-hosting-manifest.json"), manifest_bytes)?;
    fs::write(
        output.join("colab_hosting.rs"),
        format!(
            "const MANIFEST: Option<&[u8]> = Some(include_bytes!({:?}));\n",
            output.join("colab-hosting-manifest.json")
        ),
    )?;
    Ok(inputs)
}
