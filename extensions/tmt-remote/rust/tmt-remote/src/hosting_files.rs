//! Hosting file acquisition: executable-derived roots and descriptor-relative no-follow reads.
//! Manifest paths never select the root; no provider, credentials, or application state is read.
use nix::{
    fcntl::{OFlag, openat},
    sys::stat::Mode,
};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileRefusal {
    Root,
    Path,
    Type,
    Length,
    Digest,
    Unavailable,
}

/// A root derived from the executable selected by trusted extension discovery.
/// Its constructor accepts no manifest data.
#[derive(Clone, Debug)]
pub struct HostingRoot(PathBuf);
impl HostingRoot {
    pub fn from_executable(executable: &Path, extension: &str) -> Result<Self, FileRefusal> {
        if !crate::canonical::extension_name(extension) || !executable.is_absolute() {
            return Err(FileRefusal::Root);
        }
        let executable = executable.canonicalize().map_err(|_| FileRefusal::Root)?;
        if !executable
            .metadata()
            .map_err(|_| FileRefusal::Root)?
            .is_file()
        {
            return Err(FileRefusal::Root);
        }
        let release = executable.parent().ok_or(FileRefusal::Root)?;
        // Cargo's ordinary checkout layout is the only development exception. Neither cwd,
        // an environment override nor a manifest-carried directory chooses the hosted tree.
        let profile = release.file_name().and_then(|name| name.to_str());
        let target = release
            .parent()
            .filter(|parent| parent.file_name().is_some_and(|n| n == "target"));
        let checkout = target
            .and_then(Path::parent)
            .filter(|parent| parent.file_name().is_some_and(|n| n == "rust"))
            .and_then(Path::parent);
        let root = match (profile, checkout) {
            (Some("debug" | "release"), Some(checkout)) => checkout
                .join("extensions")
                .join(format!("tmt-{extension}"))
                .join("typescript/app/dist-hosted"),
            _ => release.join("dist-hosted"),
        };
        // Require a canonical, all-directory path, including its ancestors. In particular,
        // canonicalizing a symlinked hosted directory must not grant its destination.
        canonical_path(&root)?;
        directory(&root)?;
        Ok(Self(root))
    }
    pub fn path(&self) -> &Path {
        &self.0
    }

    /// Verify with bounded streaming memory, then rewind the same no-follow regular-file handle.
    /// The read is limited by the declared length plus one, never by a product size cap.
    pub fn open_verified(
        &self,
        path: &Path,
        length: u64,
        sha256: &str,
    ) -> Result<File, FileRefusal> {
        canonical_path(path)?;
        let relative = path.strip_prefix(&self.0).map_err(|_| FileRefusal::Path)?;
        let mut components = relative.components().peekable();
        let mut parent = directory(&self.0)?;
        let mut file = loop {
            let Some(Component::Normal(name)) = components.next() else {
                return Err(FileRefusal::Path);
            };
            if components.peek().is_some() {
                parent = child_directory(&parent, Path::new(name))?;
            } else {
                let fd = openat(
                    &parent,
                    Path::new(name),
                    OFlag::O_RDONLY | OFlag::O_NOFOLLOW | OFlag::O_CLOEXEC | OFlag::O_NONBLOCK,
                    Mode::empty(),
                )
                .map_err(|_| FileRefusal::Unavailable)?;
                break File::from(fd);
            }
        };
        let metadata = file.metadata().map_err(|_| FileRefusal::Unavailable)?;
        if !metadata.is_file() {
            return Err(FileRefusal::Type);
        }
        if metadata.len() != length {
            return Err(FileRefusal::Length);
        }
        let mut left = length.checked_add(1).ok_or(FileRefusal::Length)?;
        let mut count = 0u64;
        let mut digest = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        while left != 0 {
            let available = left.min(buffer.len() as u64) as usize;
            let read = file
                .read(&mut buffer[..available])
                .map_err(|_| FileRefusal::Unavailable)?;
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
            count += read as u64;
            left -= read as u64;
        }
        if count != length || file.metadata().map_err(|_| FileRefusal::Unavailable)?.len() != length
        {
            return Err(FileRefusal::Length);
        }
        let actual: String = digest
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if actual != sha256 {
            return Err(FileRefusal::Digest);
        }
        file.seek(SeekFrom::Start(0))
            .map_err(|_| FileRefusal::Unavailable)?;
        Ok(file)
    }
}
fn canonical_path(path: &Path) -> Result<(), FileRefusal> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::RootDir | Component::Normal(_)))
    {
        return Err(FileRefusal::Path);
    }
    let canonical = path.canonicalize().map_err(|_| FileRefusal::Unavailable)?;
    if canonical.as_os_str() != path.as_os_str() {
        return Err(FileRefusal::Path);
    }
    Ok(())
}
fn directory(path: &Path) -> Result<File, FileRefusal> {
    let mut parent = File::open("/").map_err(|_| FileRefusal::Unavailable)?;
    for component in path.components() {
        match component {
            Component::RootDir => (),
            Component::Normal(name) => parent = child_directory(&parent, Path::new(name))?,
            _ => return Err(FileRefusal::Path),
        }
    }
    Ok(parent)
}
fn child_directory(parent: &File, name: &Path) -> Result<File, FileRefusal> {
    openat(
        parent,
        name,
        OFlag::O_RDONLY | OFlag::O_DIRECTORY | OFlag::O_NOFOLLOW | OFlag::O_CLOEXEC,
        Mode::empty(),
    )
    .map(File::from)
    .map_err(|_| FileRefusal::Unavailable)
}

/// Parse coordinates against the trusted root and portable declaration; this alone verifies no file.
pub fn manifest_paths(
    root: &HostingRoot,
    manifest: &crate::hosting::HostingManifest,
    reply: &[u8],
) -> Result<Vec<(String, crate::hosting::HostingFileReference)>, crate::hosting::HostingRefusal> {
    use crate::hosting::{HostingFile, HostingFileReference, HostingRefusal};
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Reply {
        version: u8,
        manifest_digest: String,
        files: Vec<HostingFile>,
    }
    if reply.len() > crate::limits::HOSTING_REPLY_BYTES {
        return Err(HostingRefusal::Bounds);
    }
    let value = crate::wire::strict_json(reply).ok_or(HostingRefusal::Shape)?;
    let reply: Reply = serde_json::from_value(value).map_err(|_| HostingRefusal::Shape)?;
    if reply.version != 1 || reply.manifest_digest != manifest.digest() {
        return Err(HostingRefusal::Digest);
    }
    if reply.files.len() != manifest.files.len() {
        return Err(HostingRefusal::FileSet);
    }
    let mut paths = Vec::new();
    for (file, expected) in reply.files.into_iter().zip(&manifest.files) {
        let absolute = PathBuf::from(&file.path);
        let relative = absolute
            .strip_prefix(root.path())
            .map_err(|_| HostingRefusal::Path)?;
        let mut metadata = file.clone();
        metadata.path = format!("/{}", relative.to_str().ok_or(HostingRefusal::Path)?);
        if &metadata != expected {
            return Err(HostingRefusal::FileSet);
        }
        paths.push((
            expected.path.clone(),
            HostingFileReference {
                path: absolute,
                length: file.length,
                sha256: file.sha256,
            },
        ));
    }
    Ok(paths)
}
/// Capture metadata only after native confinement/integrity verification and shared gzip preparation.
pub fn capture(
    root: &HostingRoot,
    manifest: &crate::hosting::HostingManifest,
    reply: &[u8],
    stop: &std::sync::atomic::AtomicBool,
) -> Result<crate::hosting::HostingBundle, crate::hosting::HostingRefusal> {
    use crate::hosting::{HostingRefusal, HostingSource};
    let mut sources = std::collections::BTreeMap::new();
    for (route, file) in manifest_paths(root, manifest, reply)? {
        root.open_verified(&file.path, file.length, &file.sha256)
            .map_err(|_| HostingRefusal::Digest)?;
        let gzip = prepare(&file, stop)?;
        if sources
            .insert(route, HostingSource { file, gzip })
            .is_some()
        {
            return Err(HostingRefusal::Collision);
        }
    }
    crate::hosting::HostingBundle::from_sources(manifest, sources)
}
/// One fixed local Node command computes gzip identity; no Firebase dependency or auth is loaded.
pub fn prepare(
    reference: &crate::hosting::HostingFileReference,
    stop: &std::sync::atomic::AtomicBool,
) -> Result<crate::hosting::HostingGzip, crate::hosting::HostingRefusal> {
    use crate::{hosting::HostingRefusal, limits};
    use std::{ffi::OsString, time::Instant};
    let search = std::env::var_os("PATH").unwrap_or_default();
    let node = tmt_invoke::find_executable(std::ffi::OsStr::new("node"), &search)
        .and_then(|path| path.canonicalize().ok())
        .ok_or(HostingRefusal::Compression)?;
    let script = format!(
        "{}\n(async()=>{{let raw='';for await(const part of process.stdin){{raw+=part;if(Buffer.byteLength(raw)>{})throw new Error('input');}}const answer=await prepare(JSON.parse(raw));process.stdout.write(JSON.stringify(answer));}})().catch(()=>{{process.exitCode=1;}});",
        include_str!("deploy_firestore/hosting-file.cjs"),
        limits::HOSTING_UPLOAD_REQUEST_BYTES
    );
    let args = [OsString::from("--eval"), OsString::from(script)];
    let input = serde_json::to_vec(reference).map_err(|_| HostingRefusal::Shape)?;
    if input.len() > limits::HOSTING_UPLOAD_REQUEST_BYTES {
        return Err(HostingRefusal::Bounds);
    }
    let output = tmt_invoke::invoke(
        tmt_invoke::Request {
            program: &node,
            args: &args,
            input: &input,
            deadline: Instant::now() + limits::HOSTING_BUNDLE_CALL,
            max_stream_bytes: 1024,
            launch: tmt_invoke::LaunchOptions {
                current_dir: Some(PathBuf::from("/")),
                environment: tmt_invoke::EnvironmentPolicy::ClearAllowlist(&[]),
                ..Default::default()
            },
        },
        Some(stop),
    )
    .map_err(|_| HostingRefusal::Compression)?;
    if !output.status.success() {
        return Err(HostingRefusal::Compression);
    }
    let value = crate::wire::strict_json(&output.stdout).ok_or(HostingRefusal::Shape)?;
    serde_json::from_value(value).map_err(|_| HostingRefusal::Shape)
}
/// Only Remote-generated public declarations/instructions are staged. Extension files stay in place.
pub struct HostingStaging {
    root: PathBuf,
    next: usize,
}
impl HostingStaging {
    pub fn new() -> Result<Self, crate::hosting::HostingRefusal> {
        use std::os::unix::fs::DirBuilderExt;
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|_| crate::hosting::HostingRefusal::Compression)?;
        let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let root = std::env::temp_dir()
            .canonicalize()
            .map_err(|_| crate::hosting::HostingRefusal::Compression)?
            .join(format!("tmt-hosting-{token}"));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&root)
            .map_err(|_| crate::hosting::HostingRefusal::Compression)?;
        Ok(Self { root, next: 0 })
    }
    pub fn generated(
        &mut self,
        metadata: &crate::hosting::HostingFile,
        bytes: &[u8],
        stop: &std::sync::atomic::AtomicBool,
    ) -> Result<crate::hosting::HostingSource, crate::hosting::HostingRefusal> {
        use crate::hosting::{HostingFileReference, HostingRefusal, HostingSource};
        use std::{io::Write, os::unix::fs::OpenOptionsExt};
        let path = self.root.join(self.next.to_string());
        self.next += 1;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(|_| HostingRefusal::Compression)?;
        file.write_all(bytes)
            .map_err(|_| HostingRefusal::Compression)?;
        drop(file);
        let file = HostingFileReference {
            path,
            length: metadata.length,
            sha256: metadata.sha256.clone(),
        };
        let gzip = prepare(&file, stop)?;
        Ok(HostingSource { file, gzip })
    }
}
impl Drop for HostingStaging {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[cfg(test)]
mod tests;
