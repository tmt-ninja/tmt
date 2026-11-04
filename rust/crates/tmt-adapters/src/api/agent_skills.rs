//! `skills.list`: the skills one member's agent can invoke (#5531). Read-only and
//! stateless: the caller caches by `rootsStamp` and asks again with `ifStamp`,
//! which answers from directory stat data alone. Skill text is display data.
use super::{Fault, Request, invalid};
use crate::{
    config::ConfigPaths,
    delivery,
    host::{Host, OperationOptions},
    runtime::skills::{self, InvocationSyntax, SkillRoot, SkillRoots, SkillSource},
    skill_installation::ProviderEnvironment,
    storage::Storage,
};
use serde::Deserialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use tmt_core::binding::{BindingEvidence, evaluate_binding};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    identity_id: String,
    if_stamp: Option<String>,
}

pub(super) fn decode(input: &[u8]) -> Result<Request, Fault> {
    let input: Input = serde_json::from_slice(input).map_err(|_| invalid())?;
    if !tmt_core::dispatch::canonical_id(&input.identity_id)
        || input
            .if_stamp
            .as_deref()
            .is_some_and(|stamp| stamp.len() != 64 || !stamp.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err(invalid());
    }
    Ok(Request::AgentSkills {
        identity_id: input.identity_id,
        if_stamp: input.if_stamp,
    })
}

pub(super) fn list(
    paths: &ConfigPaths,
    storage: &mut Storage,
    id: &str,
    if_stamp: Option<&str>,
) -> Result<Vec<u8>, Fault> {
    let environment = ProviderEnvironment::capture()
        .map_err(|_| Fault::unavailable())?
        .with_data_root(&paths.global_dir);
    let (roots, driver) = roots(storage, id, &environment, &paths.global_dir)?;
    respond(
        &roots,
        driver.as_deref(),
        &paths.global_dir.join("skill-assets"),
        if_stamp,
        crate::request_runtime::wall_time_ms(),
    )
}

/// The member's remembered driver and the roots it reads. An unknown identity, an
/// unknown driver or one without skill invocation reads only TMT's own published skills
/// (#5924), from no provider path.
fn roots(
    storage: &mut Storage,
    id: &str,
    environment: &ProviderEnvironment,
    global: &Path,
) -> Result<(SkillRoots, Option<String>), Fault> {
    let Some(entry) = delivery::current(storage, id).map_err(|_| Fault::unavailable())? else {
        return Ok((tmt_only(global), None));
    };
    // Only Core's remembered harness names the driver, never a path or a pane.
    let harness = storage
        .remembered_driver(id)
        .map_err(|_| Fault::unavailable())?
        .and_then(|driver| tmt_core::binding::session::HarnessId::new(&driver).ok());
    let driver = harness.as_ref().map(|harness| harness.as_str().to_owned());
    let registry = crate::runtime::RuntimeRegistry::first_party();
    let roots = match harness
        .as_ref()
        .and_then(|harness| registry.lifecycle(harness))
    {
        Some(lifecycle) => lifecycle.skill_roots(environment, pane_cwd(&entry).as_deref()),
        None => SkillRoots::unsupported(),
    };
    Ok(if roots.syntax == InvocationSyntax::Unsupported {
        (tmt_only(global), driver)
    } else {
        (roots, driver)
    })
}

/// TMT's own current skills: this tmt's bundle and each extension-owned skill's source,
/// read through the same bounded walk as every other group. An unreadable record lists
/// none rather than failing the read.
fn tmt_only(global: &Path) -> SkillRoots {
    SkillRoots {
        syntax: InvocationSyntax::Unsupported,
        roots: crate::skill_installation::published_sources(global)
            .unwrap_or_default()
            .into_iter()
            .map(|path| SkillRoot {
                path,
                source: SkillSource::Tmt,
            })
            .collect(),
    }
}

/// The bound pane's current directory as its host reports it, if it does.
fn pane_cwd(entry: &tmt_core::binding::BindingEntry) -> Option<PathBuf> {
    let binding = entry.binding.as_ref()?;
    let probe = Host::for_server(&binding.server)
        .probe(
            &binding.server,
            OperationOptions {
                deadline: None,
                pane_ids: Some(std::slice::from_ref(&binding.pane_id)),
            },
        )
        .ok()?;
    match evaluate_binding(entry, &probe) {
        BindingEvidence::Active(pane) => pane.cwd.map(PathBuf::from).filter(|p| p.is_absolute()),
        _ => None,
    }
}

fn respond(
    roots: &SkillRoots,
    driver: Option<&str>,
    assets: &Path,
    if_stamp: Option<&str>,
    now: u64,
) -> Result<Vec<u8>, Fault> {
    let stamp = skills::stamp(roots, assets, driver);
    let value = if if_stamp == Some(stamp.as_str()) {
        json!({"unchanged": true, "rootsStamp": stamp, "observedAtMs": now})
    } else {
        let list = skills::list(roots, assets);
        json!({
            "syntax": roots.syntax,
            "driver": driver,
            "skills": list.skills,
            "truncated": list.truncated,
            "rootsStamp": stamp,
            "observedAtMs": now,
        })
    };
    serde_json::to_vec(&value).map_err(|_| Fault::unavailable())
}

#[cfg(test)]
#[path = "agent_skills_tests.rs"]
mod tests;
