//! Offline composer port over fixture-owned plain files and the production capture/preparation owners.
//! Provider/account acceptance is separate; this helper supplies no alternate wire parser or codec.
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    cell::RefCell,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use tmt_remote::{
    hosting::{
        self, HostingBundle, HostingComposition, HostingFile, HostingFileReference, HostingInput,
        HostingManifest, HostingRefusal, HostingSource,
    },
    hosting_files::{self, HostingRoot},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct World {
    path: PathBuf,
    next: usize,
}
impl World {
    fn new() -> Self {
        let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tmt-hosted-fixture-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        fs::create_dir(path.join("dist-hosted")).unwrap();
        fs::write(path.join("tmt-colab"), b"fixture executable").unwrap();
        Self { path, next: 0 }
    }
    fn root(&mut self) -> HostingRoot {
        let release = self.path.join(format!("capture-{}", self.next));
        self.next += 1;
        fs::create_dir_all(release.join("dist-hosted")).unwrap();
        fs::write(release.join("tmt-colab"), b"fixture executable").unwrap();
        HostingRoot::from_executable(&release.join("tmt-colab"), "colab").unwrap()
    }
    fn source(
        &mut self,
        metadata: &HostingFile,
        raw: &[u8],
    ) -> Result<HostingSource, HostingRefusal> {
        if metadata.length != raw.len() as u64 || metadata.sha256 != hosting_hash(raw) {
            return Err(HostingRefusal::Digest);
        }
        let path = self.path.join(format!("generated-{}", self.next));
        self.next += 1;
        fs::write(&path, raw).unwrap();
        let file = HostingFileReference {
            path,
            length: metadata.length,
            sha256: metadata.sha256.clone(),
        };
        let gzip = hosting_files::prepare(&file, &std::sync::atomic::AtomicBool::new(false))?;
        Ok(HostingSource { file, gzip })
    }
}
impl Drop for World {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.path).unwrap();
    }
}
thread_local! {static WORLD:RefCell<World>=RefCell::new(World::new());}
fn hosting_hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
pub fn source(metadata: &HostingFile, raw: &[u8]) -> Result<HostingSource, HostingRefusal> {
    WORLD.with(|world| world.borrow_mut().source(metadata, raw))
}
pub fn compose(inputs: &[HostingInput<'_>]) -> Result<Option<HostingComposition>, HostingRefusal> {
    hosting::compose(inputs, source)
}
/// Materialize large fixture content directly, without a byte-bearing JSON envelope.
#[allow(
    dead_code,
    reason = "Shared fixture: large-content scenarios live only in hosting tests."
)]
pub fn from_contents(
    manifest: &HostingManifest,
    contents: &[(&str, &[u8])],
) -> Result<HostingBundle, HostingRefusal> {
    WORLD.with(|world| {
        let root = world.borrow_mut().root();
        let mut listed = Vec::new();
        for (route, raw) in contents {
            let metadata = manifest
                .files
                .iter()
                .find(|f| f.path == *route)
                .ok_or(HostingRefusal::FileSet)?;
            let relative = route.strip_prefix('/').ok_or(HostingRefusal::Path)?;
            if !std::path::Path::new(relative)
                .components()
                .all(|part| matches!(part, std::path::Component::Normal(_)))
            {
                return Err(HostingRefusal::Path);
            }
            let path = root.path().join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, raw).unwrap();
            let mut file = serde_json::to_value(metadata).unwrap();
            file["path"] = json!(path);
            listed.push(file);
        }
        // Caller content order is irrelevant; the wire inventory follows the manifest.
        listed.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
        hosting_files::capture(
            &root,
            manifest,
            &serde_json::to_vec(
                &json!({"version":1,"manifestDigest":manifest.digest(),"files":listed}),
            )
            .unwrap(),
            &std::sync::atomic::AtomicBool::new(false),
        )
    })
}
/// Scenario payloads use explicit fixtureBytes arrays; only production-shaped file metadata crosses the parser.
pub fn parse(manifest: &HostingManifest, fixture: &[u8]) -> Result<HostingBundle, HostingRefusal> {
    let mut value = tmt_remote::wire::strict_json(fixture).ok_or(HostingRefusal::Shape)?;
    WORLD.with(|world| {
        let mut world = world.borrow_mut();
        let root = world.root();
        let files = value["files"].as_array_mut().ok_or(HostingRefusal::Shape)?;
        for (index, file) in files.iter_mut().enumerate() {
            let object = file.as_object_mut().ok_or(HostingRefusal::Shape)?;
            let bytes: Vec<u8> =
                serde_json::from_value(object.remove("fixtureBytes").ok_or(HostingRefusal::Shape)?)
                    .map_err(|_| HostingRefusal::Shape)?;
            let route = object
                .remove("path")
                .and_then(|p| p.as_str().map(str::to_owned))
                .ok_or(HostingRefusal::Shape)?;
            let metadata = manifest.files.get(index).ok_or(HostingRefusal::FileSet)?;
            let relative = route.strip_prefix('/').ok_or(HostingRefusal::Path)?;
            if !std::path::Path::new(relative)
                .components()
                .all(|part| matches!(part, std::path::Component::Normal(_)))
            {
                return Err(HostingRefusal::Path);
            }
            let absolute = root.path().join(relative);
            fs::create_dir_all(absolute.parent().unwrap()).unwrap();
            fs::write(&absolute, &bytes).unwrap();
            let mut wire = serde_json::to_value(metadata).unwrap();
            wire["path"] = json!(absolute);
            for (key, extra) in object.iter() {
                wire[key] = extra.clone();
            }
            *file = wire;
        }
        let reply = serde_json::to_vec(&value).unwrap();
        hosting_files::capture(
            &root,
            manifest,
            &reply,
            &std::sync::atomic::AtomicBool::new(false),
        )
    })
}
#[allow(
    dead_code,
    reason = "Shared fixture: only byte-identity scenarios inspect compressed output."
)]
pub fn gzip(content: &HostingComposition, path: &str) -> Option<Vec<u8>> {
    let source = content.source(path)?;
    let node = tmt_invoke::find_executable(
        std::ffi::OsStr::new("node"),
        &std::env::var_os("PATH").unwrap_or_default(),
    )
    .unwrap()
    .canonicalize()
    .unwrap();
    let args = [
        std::ffi::OsString::from("--eval"),
        std::ffi::OsString::from(
            "const fs=require('node:fs'),z=require('node:zlib');const b=z.gzipSync(fs.readFileSync(process.argv[1]),{level:6});b[9]=255;process.stdout.write(b);",
        ),
        source.file.path.as_os_str().to_owned(),
    ];
    let output = tmt_invoke::invoke(
        tmt_invoke::Request {
            program: &node,
            args: &args,
            input: &[],
            deadline: std::time::Instant::now() + std::time::Duration::from_secs(30),
            max_stream_bytes: source.file.length as usize * 2 + 1024,
            launch: tmt_invoke::LaunchOptions {
                current_dir: Some(PathBuf::from("/")),
                environment: tmt_invoke::EnvironmentPolicy::ClearAllowlist(&[]),
                ..Default::default()
            },
        },
        None,
    )
    .unwrap();
    assert!(output.status.success());
    assert_eq!(hosting_hash(&output.stdout), source.gzip.sha256);
    Some(output.stdout)
}
