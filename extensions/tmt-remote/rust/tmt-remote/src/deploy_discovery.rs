//! Fixed public extension commands supply release-embedded declaration bytes.
//! Hosting files are confined to a root derived from the resolved installed/dev executable.
use crate::{
    canonical, declaration,
    deploy_plan::{self, CloudBackend, Enabled, Supplied, Target},
    hosting::{self, HostingBundle, HostingComposition, HostingInput, HostingRefusal},
    limits, rules, wire,
};
use serde_json::Value;
use std::{ffi::OsString, path::PathBuf, sync::atomic::AtomicBool, time::Instant};
use tmt_invoke::{EnvironmentPolicy, LaunchOptions, Request};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiscoveryRefusal {
    Unavailable,
    Envelope,
    Declaration,
    Digest,
    Plan(deploy_plan::PlanError),
    Rules(rules::RulesError),
    Hosting(HostingRefusal),
}
/// One bounded reply from a trusted enabled extension's public command.
pub trait DeclarationSource {
    fn declaration(&mut self, extension: &str) -> Result<Option<Vec<u8>>, DiscoveryRefusal>;
    /// Only called when the validated declaration includes a Hosting manifest.
    fn hosting_bundle(
        &mut self,
        _extension: &str,
        _manifest: &hosting::HostingManifest,
    ) -> Result<HostingBundle, DiscoveryRefusal> {
        Err(DiscoveryRefusal::Unavailable)
    }
    fn generated_hosting(
        &mut self,
        _file: &hosting::HostingFile,
        _bytes: &[u8],
    ) -> Result<hosting::HostingSource, HostingRefusal> {
        Err(HostingRefusal::Compression)
    }
    fn take_hosting_staging(&mut self) -> Option<crate::hosting_files::HostingStaging> {
        None
    }
}
/// Same public TMT_EXECUTABLE dispatch edge as Colab's door discovery.
pub struct InstalledDeclarations<'a> {
    executable: PathBuf,
    stop: &'a AtomicBool,
    staging: Option<crate::hosting_files::HostingStaging>,
    executables: std::collections::BTreeMap<String, PathBuf>,
}
impl<'a> InstalledDeclarations<'a> {
    pub fn new(stop: &'a AtomicBool) -> Result<Self, DiscoveryRefusal> {
        Ok(Self {
            executable: tmt_invoke::invoking_tmt().map_err(|_| DiscoveryRefusal::Unavailable)?,
            stop,
            staging: None,
            executables: Default::default(),
        })
    }
    pub fn at(executable: PathBuf, stop: &'a AtomicBool) -> Result<Self, DiscoveryRefusal> {
        if !executable.is_absolute() {
            return Err(DiscoveryRefusal::Unavailable);
        }
        Ok(Self {
            executable,
            stop,
            staging: None,
            executables: Default::default(),
        })
    }
    /// Composition callers may supply already-resolved commands; never supplied by a manifest.
    pub fn at_extensions(
        executable: PathBuf,
        executables: std::collections::BTreeMap<String, PathBuf>,
        stop: &'a AtomicBool,
    ) -> Result<Self, DiscoveryRefusal> {
        if executables.len() > limits::PLAN_EXTENSIONS
            || executables.iter().any(|(name, path)| {
                !canonical::extension_name(name)
                    || !path.is_absolute()
                    || !tmt_invoke::is_executable(path)
            })
        {
            return Err(DiscoveryRefusal::Unavailable);
        }
        let mut source = Self::at(executable, stop)?;
        source.executables = executables;
        Ok(source)
    }
}
impl InstalledDeclarations<'_> {
    fn public_command(
        &self,
        extension: &str,
        command: &str,
        deadline: std::time::Duration,
        max_stream_bytes: usize,
    ) -> Result<tmt_invoke::Output, DiscoveryRefusal> {
        if !canonical::extension_name(extension) {
            return Err(DiscoveryRefusal::Envelope);
        }
        let args = [extension, command, "--json"].map(OsString::from);
        let environment = [
            "HOME",
            "PATH",
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
            "XDG_STATE_HOME",
            "XDG_CACHE_HOME",
            "TMT_HOME",
        ]
        .map(OsString::from);
        tmt_invoke::invoke(
            Request {
                program: &self.executable,
                args: &args,
                input: &[],
                deadline: Instant::now() + deadline,
                max_stream_bytes,
                launch: LaunchOptions {
                    current_dir: Some(PathBuf::from("/")),
                    environment: EnvironmentPolicy::ClearAllowlist(&environment),
                    ..Default::default()
                },
            },
            Some(self.stop),
        )
        .map_err(|_| DiscoveryRefusal::Unavailable)
    }
}
impl DeclarationSource for InstalledDeclarations<'_> {
    fn declaration(&mut self, extension: &str) -> Result<Option<Vec<u8>>, DiscoveryRefusal> {
        let output = self.public_command(
            extension,
            "deploy-declaration",
            limits::DEPLOY_DECLARATION_CALL,
            limits::DEPLOY_DECLARATION_REPLY_BYTES,
        )?;
        if !output.status.success() {
            // An old installed command does not provide a declaration. All other failures
            // remain unavailable; stderr and raw exception text are never surfaced.
            let reply = wire::strict_json(&output.stdout).ok_or(DiscoveryRefusal::Unavailable)?;
            // Old Colab reports its unknown public subcommand as COLAB_INPUT_INVALID.
            return match reply["error"]["code"].as_str() {
                Some("USAGE_ERROR" | "EXTENSION_NOT_INSTALLED" | "COLAB_INPUT_INVALID") => Ok(None),
                _ => Err(DiscoveryRefusal::Unavailable),
            };
        }
        Ok(Some(output.stdout))
    }
    fn hosting_bundle(
        &mut self,
        extension: &str,
        manifest: &hosting::HostingManifest,
    ) -> Result<HostingBundle, DiscoveryRefusal> {
        let output = self.public_command(
            extension,
            "hosting-bundle",
            limits::HOSTING_BUNDLE_CALL,
            limits::HOSTING_REPLY_BYTES,
        )?;
        if !output.status.success() {
            return Err(DiscoveryRefusal::Unavailable);
        }
        // Match Core's PATH lookup from the neutral command cwd. A manifest cannot pick this path.
        let search = std::env::var_os("PATH").unwrap_or_default();
        let executable = match self.executables.get(extension) {
            Some(path) => path.clone(),
            None => std::env::split_paths(&search)
                .map(|directory| {
                    PathBuf::from("/")
                        .join(directory)
                        .join(format!("tmt-{extension}"))
                })
                .find(|path| tmt_invoke::is_executable(path))
                .ok_or(DiscoveryRefusal::Unavailable)?,
        };
        let root = crate::hosting_files::HostingRoot::from_executable(&executable, extension)
            .map_err(|_| DiscoveryRefusal::Unavailable)?;
        crate::hosting_files::capture(&root, manifest, &output.stdout, self.stop)
            .map_err(DiscoveryRefusal::Hosting)
    }
    fn generated_hosting(
        &mut self,
        file: &hosting::HostingFile,
        bytes: &[u8],
    ) -> Result<hosting::HostingSource, HostingRefusal> {
        if self.staging.is_none() {
            self.staging = Some(crate::hosting_files::HostingStaging::new()?);
        }
        self.staging
            .as_mut()
            .expect("staging created")
            .generated(file, bytes, self.stop)
    }
    fn take_hosting_staging(&mut self) -> Option<crate::hosting_files::HostingStaging> {
        self.staging.take()
    }
}
struct Bytes {
    name: String,
    declaration: Vec<u8>,
    artifact: Vec<u8>,
}
/// The exact snapshot composed once, then passed to the existing command/engine.
pub struct DiscoveredPlan {
    pub extensions: deploy_plan::Plan,
    pub artifacts: rules::Composed,
    pub hosting: Option<HostingComposition>,
    // Keep only Remote-generated files alive through the complete command/provider lifecycle.
    _hosting_staging: Option<crate::hosting_files::HostingStaging>,
}
pub fn discover(
    source: &mut dyn DeclarationSource,
    enabled: &[&str],
) -> Result<DiscoveredPlan, DiscoveryRefusal> {
    if enabled.len() > limits::PLAN_EXTENSIONS {
        return Err(DiscoveryRefusal::Envelope);
    }
    let mut names = enabled.to_vec();
    names.sort_unstable();
    if names.windows(2).any(|p| p[0] == p[1]) || names.iter().any(|n| !canonical::extension_name(n))
    {
        return Err(DiscoveryRefusal::Envelope);
    }
    let mut supplied = Vec::new();
    for name in &names {
        if let Some(reply) = source.declaration(name)? {
            supplied.push(parse(name, &reply)?);
        }
    }
    let inputs: Vec<_> = names
        .iter()
        .map(|name| Enabled {
            name,
            supplied: supplied.iter().find(|b| b.name == *name).map(|b| Supplied {
                declaration: &b.declaration,
                artifact: &b.artifact,
            }),
        })
        .collect();
    let extensions = deploy_plan::compose(
        Target {
            backend: CloudBackend::Firestore,
            physical_ttl: false,
        },
        &inputs,
    )
    .map_err(DiscoveryRefusal::Plan)?;
    let fragments: Vec<_> = supplied
        .iter()
        .map(|b| rules::Fragment {
            extension: &b.name,
            source: &b.artifact,
        })
        .collect();
    let artifacts = rules::compose(&extensions, &fragments).map_err(DiscoveryRefusal::Rules)?;
    let mut bundles = Vec::new();
    for extension in &extensions.view().extensions {
        if let Some(manifest) = &extension.hosting {
            let bundle = source.hosting_bundle(&extension.name, manifest)?;
            let bytes = supplied
                .iter()
                .find(|bytes| bytes.name == extension.name)
                .ok_or(DiscoveryRefusal::Declaration)?;
            bundles.push((
                extension.name.as_str(),
                bytes.declaration.as_slice(),
                bundle,
            ));
        }
    }
    let hosting_inputs: Vec<_> = bundles
        .iter()
        .map(|(extension, declaration, bundle)| HostingInput {
            extension,
            declaration,
            bundle,
        })
        .collect();
    let hosting = hosting::compose(&hosting_inputs, |file, bytes| {
        source.generated_hosting(file, bytes)
    })
    .map_err(DiscoveryRefusal::Hosting)?;
    Ok(DiscoveredPlan {
        extensions,
        artifacts,
        hosting,
        _hosting_staging: source.take_hosting_staging(),
    })
}
/// Capture the exact release declaration without deploying or fetching Hosting.
/// Reuse the envelope parser and backend/admission-artifact validation used by
/// deployment; this does not supply provider or owner authority.
pub fn sealed_declaration(name: &str, reply: &[u8]) -> Result<(Vec<u8>, String), DiscoveryRefusal> {
    let captured = parse(name, reply)?;
    deploy_plan::compose(
        Target {
            backend: CloudBackend::Firestore,
            physical_ttl: false,
        },
        &[Enabled {
            name,
            supplied: Some(Supplied {
                declaration: &captured.declaration,
                artifact: &captured.artifact,
            }),
        }],
    )
    .map_err(DiscoveryRefusal::Plan)?;
    let digest = deploy_plan::sha256_hex(&captured.declaration);
    Ok((captured.declaration, digest))
}

fn parse(name: &str, bytes: &[u8]) -> Result<Bytes, DiscoveryRefusal> {
    if bytes.len() > limits::DEPLOY_DECLARATION_REPLY_BYTES {
        return Err(DiscoveryRefusal::Envelope);
    }
    let value: Value = wire::strict_json(bytes).ok_or(DiscoveryRefusal::Envelope)?;
    let object = value.as_object().ok_or(DiscoveryRefusal::Envelope)?;
    if object.len() != 6
        || value["version"] != 1
        || value["extension"] != name
        || value["backend"] != "firestore"
    {
        return Err(DiscoveryRefusal::Envelope);
    }
    let declaration = value["declaration"]
        .as_str()
        .ok_or(DiscoveryRefusal::Envelope)?
        .as_bytes();
    let artifact = value["artifact"]
        .as_str()
        .ok_or(DiscoveryRefusal::Envelope)?
        .as_bytes();
    if artifact.len() > limits::DECLARATION_ARTIFACT_BYTES {
        return Err(DiscoveryRefusal::Envelope);
    }
    if value["declarationDigest"].as_str() != Some(deploy_plan::sha256_hex(declaration).as_str()) {
        return Err(DiscoveryRefusal::Digest);
    }
    let parsed = declaration::parse(declaration).map_err(|_| DiscoveryRefusal::Declaration)?;
    if parsed.extension != name || parsed.backend != declaration::Backend::Firestore {
        return Err(DiscoveryRefusal::Declaration);
    }
    Ok(Bytes {
        name: name.to_owned(),
        declaration: declaration.to_vec(),
        artifact: artifact.to_vec(),
    })
}
