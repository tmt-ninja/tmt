//! Portable hosted metadata, with installed/dev file coordinates resolved from this executable.
const HOSTING_MANIFEST_REPLY_BYTES: usize = 256 * 1024;
include!(concat!(env!("OUT_DIR"), "/colab_hosting.rs"));

pub fn bundle() -> crate::Result<Vec<u8>> {
    let manifest = MANIFEST.ok_or("This executable has no hosted Colab inventory")?;
    let mut value: serde_json::Value = serde_json::from_slice(manifest)?;
    let executable = std::env::current_exe()?.canonicalize()?;
    let release = executable.parent().ok_or("Missing executable directory")?;
    let checkout = release
        .parent()
        .filter(|p| p.file_name().is_some_and(|name| name == "target"))
        .and_then(std::path::Path::parent)
        .filter(|p| p.file_name().is_some_and(|name| name == "rust"))
        .and_then(std::path::Path::parent);
    let root = match (release.file_name().and_then(|n| n.to_str()), checkout) {
        (Some("debug" | "release"), Some(checkout)) => {
            checkout.join("extensions/tmt-colab/typescript/app/dist-hosted")
        }
        _ => release.join("dist-hosted"),
    }
    .canonicalize()?;
    let files = value["files"]
        .as_array_mut()
        .ok_or("Invalid hosted metadata")?;
    for file in files.iter_mut() {
        let route = file["path"]
            .as_str()
            .and_then(|route| route.strip_prefix('/'))
            .ok_or("Invalid hosted path")?;
        file["path"] = serde_json::json!(root.join(route));
    }
    let digest: String = <sha2::Sha256 as sha2::Digest>::digest(manifest)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let reply = serde_json::to_vec(
        &serde_json::json!({"version":1,"manifestDigest":digest,"files":files}),
    )?;
    if reply.len() > HOSTING_MANIFEST_REPLY_BYTES {
        return Err("Hosted manifest exceeds its JSON bound".into());
    }
    Ok(reply)
}

/// Canonical portable metadata, independent of installation and checkout coordinates.
pub fn manifest() -> Option<&'static [u8]> {
    MANIFEST
}
