//! First installation through the same release verifier and activation owner as updates.

use super::{
    ActivationRequest, InstallReport, Product, ReleaseVerifier, activate, artifact, release,
};
use semver::Version;
use std::{
    io,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use tmt_core::native_install::{Channel, PinAction, VersionError};

/// Maximum concurrent release-discovery or archive-download workers sharing one HTTP client.
pub const MAX_PARALLEL_ACQUISITION: usize = 4;

/// A verified-descriptor downloaded release ready for ordered local verification and activation.
pub struct PrefetchedRelease {
    pub(super) product: Product,
    pub(super) channel: Channel,
    pub(super) target: String,
    pub(super) release: release::DownloadedRelease,
}

impl PrefetchedRelease {
    pub fn product(&self) -> Product {
        self.product
    }
    pub fn version(&self) -> &Version {
        &self.release.version
    }
    pub fn archive_bytes(&self) -> u64 {
        self.release.archive.len() as u64
    }
}

pub struct PrefetchRequest {
    pub product: Product,
    pub channel: Channel,
    pub version: String,
    pub target: String,
}

pub struct ReleaseInstallRequest<'a> {
    pub prefix: &'a Path,
    pub target: &'a str,
    pub channel: Channel,
    pub exact: Option<&'a str>,
}

pub fn default_install_prefix() -> io::Result<PathBuf> {
    std::env::home_dir()
        .map(|home| home.join(".local"))
        .ok_or_else(|| io::Error::other("Cannot determine the native installation home directory."))
}

pub fn install_release(
    product: Product,
    request: ReleaseInstallRequest<'_>,
    verifier: Option<ReleaseVerifier<'_>>,
    checkpoint: impl FnMut() -> io::Result<()>,
) -> io::Result<InstallReport> {
    install_release_observed(product, request, verifier, checkpoint, &|_| {})
}

/// Preview only fixed official release metadata. No archive, prefix or skill writes.
/// The CLI treats an unavailable preview as unknown version/size, not a refusal.
pub fn preview_release(product: Product, target: &str) -> io::Result<super::ReleasePreview> {
    let deadline = Instant::now() + Duration::from_secs(3);
    let client = crate::release_http::Https::new();
    release::preview_product(product, target, deadline, &mut |url, accept, limit, end| {
        client.get(url, accept, limit, end)
    })
}

pub fn install_release_observed(
    product: Product,
    request: ReleaseInstallRequest<'_>,
    verifier: Option<ReleaseVerifier<'_>>,
    checkpoint: impl FnMut() -> io::Result<()>,
    progress: super::ProgressObserver<'_>,
) -> io::Result<InstallReport> {
    install_online(
        product,
        request,
        verifier,
        checkpoint,
        progress,
        InstallPurpose::Explicit,
    )
}

#[derive(Clone, Copy)]
enum InstallPurpose {
    Explicit,
    ApprovedMissing,
}

/// Select exact approved bytes without creating a pin. Publication requires continued absence.
pub fn install_missing_release_observed(
    product: Product,
    request: ReleaseInstallRequest<'_>,
    verifier: Option<ReleaseVerifier<'_>>,
    checkpoint: impl FnMut() -> io::Result<()>,
    progress: super::ProgressObserver<'_>,
) -> io::Result<InstallReport> {
    if request.exact.is_none() {
        return Err(io::Error::other(
            "Missing-item installation requires an approved exact release.",
        ));
    }
    install_online(
        product,
        request,
        verifier,
        checkpoint,
        progress,
        InstallPurpose::ApprovedMissing,
    )
}

/// Apply an already-downloaded missing extension release through the exact verification and
/// atomic activation path without performing any network request.
pub fn install_missing_release_prefetched_observed(
    product: Product,
    request: ReleaseInstallRequest<'_>,
    prefetched: PrefetchedRelease,
    verifier: Option<ReleaseVerifier<'_>>,
    checkpoint: impl FnMut() -> io::Result<()>,
    progress: super::ProgressObserver<'_>,
) -> io::Result<InstallReport> {
    if request.exact.is_none() {
        return Err(io::Error::other(
            "Missing-item installation requires an approved exact release.",
        ));
    }
    if prefetched.product != product
        || prefetched.channel != request.channel
        || prefetched.target != request.target
        || request.exact != Some(prefetched.release.version.to_string().as_str())
    {
        return Err(super::invalid(
            "Prefetched release does not match the approved missing-item target.",
        ));
    }
    let archive_bytes = prefetched.release.archive.len() as u64;
    progress(super::ProgressEvent::Selected {
        version: &prefetched.release.version.to_string(),
        archive_bytes,
    });
    progress(super::ProgressEvent::Download {
        received_bytes: archive_bytes,
        total_bytes: Some(archive_bytes),
    });
    progress(super::ProgressEvent::Downloaded);
    install_release_with_purpose(
        product,
        request,
        verifier,
        checkpoint,
        |_, _, _, _| {
            Err(super::invalid(
                "Prefetched install cannot perform network IO.",
            ))
        },
        progress,
        InstallPurpose::ApprovedMissing,
        Some(prefetched.release),
    )
}

fn install_online(
    product: Product,
    request: ReleaseInstallRequest<'_>,
    verifier: Option<ReleaseVerifier<'_>>,
    checkpoint: impl FnMut() -> io::Result<()>,
    progress: super::ProgressObserver<'_>,
    purpose: InstallPurpose,
) -> io::Result<InstallReport> {
    let channel = request.channel;
    let deadline = Instant::now() + Duration::from_secs(60);
    let client = if matches!(channel, Channel::Pr(_)) {
        crate::release_http::Https::authenticated()?
    } else {
        crate::release_http::Https::new()
    };
    install_release_with_purpose(
        product,
        request,
        verifier,
        checkpoint,
        |url, accept, limit, request_deadline| {
            let request_deadline = request_deadline.min(deadline);
            if matches!(channel, Channel::Pr(_)) && url.ends_with("/zip") {
                client.get_actions(url, limit, request_deadline)
            } else {
                client.get_observed(
                    url,
                    accept,
                    limit,
                    request_deadline,
                    &|received_bytes, total_bytes| {
                        if accept == "application/octet-stream" && url.ends_with(".tar.gz") {
                            progress(super::ProgressEvent::Download {
                                received_bytes,
                                total_bytes,
                            });
                        }
                    },
                )
            }
        },
        progress,
        purpose,
        None,
    )
}

/// The newest published version of `product` in `channel`, by bounded
/// metadata discovery only: nothing is downloaded or installed.
pub fn latest_release_version(product: Product, channel: Channel) -> io::Result<Version> {
    if matches!(channel, Channel::Pr(_)) {
        return Err(io::Error::other(super::pr_resolver::Unavailable(
            "PR channels require target-aware authenticated acquisition; published-release discovery cannot select a PR candidate.",
        )));
    }
    let client = crate::release_http::Https::new();
    release::discover_latest(
        product,
        channel,
        Instant::now() + Duration::from_secs(10),
        &mut |url, accept, limit, deadline| client.get(url, accept, limit, deadline),
    )
    .map(|(_, version)| version)
}

/// Bounded-parallel published-release discovery sharing one HTTP client across at most
/// [`MAX_PARALLEL_ACQUISITION`] workers. Output order matches `requests` 1:1 and failures are
/// isolated per product.
pub fn latest_release_versions(requests: &[(Product, Channel)]) -> Vec<io::Result<Version>> {
    if requests.is_empty() {
        return Vec::new();
    }
    let client = crate::release_http::Https::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    latest_release_versions_with(requests, deadline, &|url, accept, limit, deadline| {
        client.get(url, accept, limit, deadline)
    })
}

pub(crate) fn latest_release_versions_with(
    requests: &[(Product, Channel)],
    deadline: Instant,
    get: &(impl Fn(&str, &str, usize, Instant) -> io::Result<crate::release_http::Response> + Sync),
) -> Vec<io::Result<Version>> {
    let discover_one = |(product, channel): (Product, Channel)| -> io::Result<Version> {
        if matches!(channel, Channel::Pr(_)) {
            return Err(io::Error::other(super::pr_resolver::Unavailable(
                "PR channels require target-aware authenticated acquisition; published-release discovery cannot select a PR candidate.",
            )));
        }
        release::discover_latest(product, channel, deadline, &mut |url, accept, limit, dl| {
            get(url, accept, limit, dl)
        })
        .map(|(_, version)| version)
    };
    if requests.len() <= 1 {
        return requests.iter().copied().map(discover_one).collect();
    }
    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<Option<io::Result<Version>>>> =
        Mutex::new((0..requests.len()).map(|_| None).collect());
    let workers = MAX_PARALLEL_ACQUISITION.min(requests.len());
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some(&request) = requests.get(index) else {
                        break;
                    };
                    let outcome = discover_one(request);
                    if let Ok(mut guard) = results.lock() {
                        guard[index] = Some(outcome);
                    }
                }
            });
        }
    });
    results
        .into_inner()
        .unwrap_or_else(|poison| poison.into_inner())
        .into_iter()
        .map(|slot| {
            slot.unwrap_or_else(|| Err(io::Error::other("Discovery worker did not finish.")))
        })
        .collect()
}

/// Bounded-parallel archive and manifest pre-download sharing one HTTP client across at most
/// [`MAX_PARALLEL_ACQUISITION`] workers. Verification and activation remain ordered per product.
pub fn prefetch_releases(
    requests: &[PrefetchRequest],
    checkpoint: &(impl Fn() -> bool + Sync),
) -> Vec<io::Result<PrefetchedRelease>> {
    if requests.is_empty() {
        return Vec::new();
    }
    let client = crate::release_http::Https::new();
    let deadline = Instant::now() + Duration::from_secs(60);
    prefetch_releases_with(
        requests,
        deadline,
        checkpoint,
        &|url, accept, limit, deadline| client.get(url, accept, limit, deadline),
    )
}

pub(crate) fn prefetch_releases_with(
    requests: &[PrefetchRequest],
    deadline: Instant,
    checkpoint: &(impl Fn() -> bool + Sync),
    get: &(impl Fn(&str, &str, usize, Instant) -> io::Result<crate::release_http::Response> + Sync),
) -> Vec<io::Result<PrefetchedRelease>> {
    let fetch_one = |request: &PrefetchRequest| -> io::Result<PrefetchedRelease> {
        if checkpoint() {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "Extension update interrupted before activation.",
            ));
        }
        if matches!(request.channel, Channel::Pr(_)) {
            return Err(io::Error::other(super::pr_resolver::Unavailable(
                "PR channels require authenticated acquisition; published-release prefetch cannot select a PR candidate.",
            )));
        }
        let version = request
            .version
            .parse::<Version>()
            .map_err(|_| io::Error::other(VersionError::InvalidSelection))?;
        let downloaded = release::download_product_observed(
            request.product,
            request.channel,
            Some(&version),
            &request.target,
            deadline,
            |url, accept, limit, dl| get(url, accept, limit, dl),
            &|_| {},
        )?;
        Ok(PrefetchedRelease {
            product: request.product,
            channel: request.channel,
            target: request.target.clone(),
            release: downloaded,
        })
    };
    if requests.len() <= 1 {
        return requests.iter().map(fetch_one).collect();
    }
    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<Option<io::Result<PrefetchedRelease>>>> =
        Mutex::new((0..requests.len()).map(|_| None).collect());
    let workers = MAX_PARALLEL_ACQUISITION.min(requests.len());
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some(request) = requests.get(index) else {
                        break;
                    };
                    let outcome = fetch_one(request);
                    if let Ok(mut guard) = results.lock() {
                        guard[index] = Some(outcome);
                    }
                }
            });
        }
    });
    results
        .into_inner()
        .unwrap_or_else(|poison| poison.into_inner())
        .into_iter()
        .map(|slot| {
            slot.unwrap_or_else(|| Err(io::Error::other("Download worker did not finish.")))
        })
        .collect()
}

#[cfg(test)]
fn install_release_with(
    product: Product,
    request: ReleaseInstallRequest<'_>,
    verifier: Option<ReleaseVerifier<'_>>,
    checkpoint: impl FnMut() -> io::Result<()>,
    get: impl FnMut(&str, &str, usize, Instant) -> io::Result<crate::release_http::Response>,
) -> io::Result<InstallReport> {
    install_release_with_observer(product, request, verifier, checkpoint, get, &|_| {})
}

#[cfg(test)]
fn install_release_with_observer(
    product: Product,
    request: ReleaseInstallRequest<'_>,
    verifier: Option<ReleaseVerifier<'_>>,
    checkpoint: impl FnMut() -> io::Result<()>,
    get: impl FnMut(&str, &str, usize, Instant) -> io::Result<crate::release_http::Response>,
    progress: super::ProgressObserver<'_>,
) -> io::Result<InstallReport> {
    install_release_with_purpose(
        product,
        request,
        verifier,
        checkpoint,
        get,
        progress,
        InstallPurpose::Explicit,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
fn install_release_with_purpose(
    product: Product,
    request: ReleaseInstallRequest<'_>,
    verifier: Option<ReleaseVerifier<'_>>,
    mut checkpoint: impl FnMut() -> io::Result<()>,
    get: impl FnMut(&str, &str, usize, Instant) -> io::Result<crate::release_http::Response>,
    progress: super::ProgressObserver<'_>,
    purpose: InstallPurpose,
    prefetched: Option<release::DownloadedRelease>,
) -> io::Result<InstallReport> {
    let ReleaseInstallRequest {
        prefix,
        target,
        channel,
        exact,
    } = request;
    let exact = exact
        .map(|version| {
            version
                .parse::<Version>()
                .map_err(|_| io::Error::other(VersionError::InvalidSelection))
        })
        .transpose()?;
    if let Some(version) = &exact
        && !channel.accepts(version)
    {
        return Err(io::Error::other(VersionError::WrongChannel));
    }
    checkpoint()?;
    let deadline = Instant::now() + Duration::from_secs(60);
    let downloaded = if let Some(downloaded) = prefetched {
        downloaded
    } else if let Channel::Pr(pr) = channel {
        super::pr_resolver::download_current(
            super::pr_resolver::Request {
                product,
                pr,
                exact: exact.as_ref(),
                target,
                opt_in: false,
                deadline,
            },
            get,
        )?
    } else {
        release::download_product_observed(
            product,
            channel,
            exact.as_ref(),
            target,
            deadline,
            get,
            progress,
        )?
    };
    checkpoint()?;
    progress(super::ProgressEvent::Verifying);
    let artifact = artifact::acquire_bytes(
        product,
        &downloaded.manifest,
        &downloaded.archive_name,
        &downloaded.archive,
        target,
    )?;
    progress(super::ProgressEvent::Verified);
    checkpoint()?;
    progress(super::ProgressEvent::Activating);
    let report = activate(
        ActivationRequest {
            caller: super::Caller::Current,
            product,
            prefix,
            channel,
            pin: if exact.is_some() && matches!(purpose, InstallPurpose::Explicit) {
                PinAction::PinCandidate
            } else {
                PinAction::Preserve
            },
            expected: match purpose {
                InstallPurpose::Explicit => super::ExpectedInstallation::Any,
                InstallPurpose::ApprovedMissing => super::ExpectedInstallation::Missing,
            },
            provenance: Some(downloaded.provenance),
            verifier,
            explicit_channel: true,
            schema: None,
        },
        &artifact,
        checkpoint,
    )?;
    progress(super::ProgressEvent::Activated);
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestDirectory;

    #[test]
    fn approved_missing_exact_selection_does_not_pin_and_refuses_a_concurrent_install() {
        for concurrent in [false, true] {
            let directory = TestDirectory::new();
            let prefix = directory.path.join("custom prefix");
            let product = Product::Ops;
            let version = "0.1.0-alpha.2";
            let (release, manifest, archive, _) =
                release::product_fixture(product, version, "aarch64-apple-darwin", 42);
            let routes = release::indexed_routes(&release, &manifest, &archive);
            let mut observed_id = None;
            let result = install_release_with_purpose(
                product,
                ReleaseInstallRequest {
                    prefix: &prefix,
                    target: "aarch64-apple-darwin",
                    channel: Channel::Alpha,
                    exact: Some(version),
                },
                None,
                || Ok(()),
                |url, _, _, _| {
                    if concurrent && observed_id.is_none() {
                        let other = install_release_with(
                            product,
                            ReleaseInstallRequest {
                                prefix: &prefix,
                                target: "aarch64-apple-darwin",
                                channel: Channel::Alpha,
                                exact: None,
                            },
                            None,
                            || Ok(()),
                            |url, _, _, _| Ok(routes.get(url).unwrap().clone().into()),
                        )?;
                        assert!(other.changed);
                        observed_id =
                            Some(super::super::inspect_product_prefix(product, &prefix)?.id);
                    }
                    assert!(
                        !url.contains("/channels/"),
                        "approval freezes the exact release"
                    );
                    Ok(routes.get(url).unwrap().clone().into())
                },
                &|_| {},
                InstallPurpose::ApprovedMissing,
                None,
            );
            let installed = super::super::inspect_product_prefix(product, &prefix).unwrap();
            assert!(installed.state.pinned_version.is_none());
            assert_eq!(installed.state.version.to_string(), version);
            if concurrent {
                assert!(
                    result
                        .unwrap_err()
                        .to_string()
                        .contains("changed while downloading")
                );
                assert_eq!(
                    Some(installed.id),
                    observed_id,
                    "the concurrent release remains current"
                );
            } else {
                assert!(result.unwrap().changed);
            }
        }
    }

    #[test]
    fn observed_install_reports_only_verified_transitions_and_retains_a_verified_receipt() {
        use std::cell::RefCell;
        let directory = TestDirectory::new();
        let prefix = directory.path.join("prefix");
        let product = Product::Ops;
        let (release, manifest, archive, _) =
            release::product_fixture(product, "0.1.0-alpha.2", "aarch64-apple-darwin", 42);
        let routes = release::indexed_routes(&release, &manifest, &archive);
        let events = RefCell::new(Vec::new());
        let report = install_release_with_observer(
            product,
            ReleaseInstallRequest {
                prefix: &prefix,
                target: "aarch64-apple-darwin",
                channel: Channel::Alpha,
                exact: None,
            },
            None,
            || Ok(()),
            |url, _, _, _| Ok(routes.get(url).unwrap().clone().into()),
            &|event| {
                events.borrow_mut().push(match event {
                    super::super::ProgressEvent::Selected {
                        version,
                        archive_bytes,
                    } => {
                        assert_eq!(version, "0.1.0-alpha.2");
                        assert_eq!(archive_bytes, archive.len() as u64);
                        "selected"
                    }
                    super::super::ProgressEvent::Downloaded => "downloaded",
                    super::super::ProgressEvent::Verifying => "verifying",
                    super::super::ProgressEvent::Verified => "verified",
                    super::super::ProgressEvent::Activating => "activating",
                    super::super::ProgressEvent::Activated => "activated",
                    _ => panic!("injected complete responses do not report chunk bytes"),
                })
            },
        )
        .unwrap();
        assert_eq!(
            *events.borrow(),
            [
                "selected",
                "downloaded",
                "verifying",
                "verified",
                "activating",
                "activated"
            ]
        );
        let installed = super::super::inspect_product_prefix(product, &prefix).unwrap();
        assert_eq!(installed.state.version.to_string(), report.version);
        assert!(report.executable.exists());
    }

    #[test]
    fn corrupt_acquisition_never_reports_verified_or_activation_or_creates_a_prefix() {
        use std::cell::RefCell;
        let directory = TestDirectory::new();
        let prefix = directory.path.join("prefix");
        let product = Product::Ops;
        let (release, manifest, archive, _) =
            release::product_fixture(product, "0.1.0-alpha.2", "aarch64-apple-darwin", 42);
        let routes = release::indexed_routes(&release, &manifest, &archive);
        let events = RefCell::new(Vec::new());
        let result = install_release_with_observer(
            product,
            ReleaseInstallRequest {
                prefix: &prefix,
                target: "aarch64-apple-darwin",
                channel: Channel::Alpha,
                exact: None,
            },
            None,
            || Ok(()),
            |url, _, _, _| {
                let mut bytes = routes.get(url).unwrap().clone();
                if url.ends_with(".tar.gz") {
                    bytes[0] ^= 1;
                }
                Ok(bytes.into())
            },
            &|event| events.borrow_mut().push(format!("{event:?}")),
        );
        assert!(result.unwrap_err().to_string().contains("SHA-256"));
        assert_eq!(events.borrow().len(), 1);
        assert!(events.borrow()[0].starts_with("Selected"));
        assert!(!prefix.exists());
    }

    #[test]
    fn exact_first_install_ignores_missing_or_stale_pointers_and_pins_verified_bytes() {
        for product in [Product::Remote, Product::Digest] {
            for pointer in [None, Some("0.1.0-alpha.1"), Some("0.1.0-alpha.3")] {
                let directory = TestDirectory::new();
                let prefix = directory.path.join("prefix");
                let version = "0.1.0-alpha.2";
                let (release, manifest, archive, _) =
                    release::product_fixture(product, version, "aarch64-apple-darwin", 42);
                let mut routes = release::indexed_routes(&release, &manifest, &archive);
                let pointer_url = format!(
                    "https://raw.githubusercontent.com/tmt-ninja/tmt/release-index/channels/{}/alpha.json",
                    product.as_str()
                );
                match pointer {
                    None => {
                        routes.remove(&pointer_url);
                    }
                    Some(version) => {
                        routes.insert(
                            pointer_url,
                            serde_json::to_vec(&serde_json::json!({"version": version})).unwrap(),
                        );
                    }
                }
                let mut calls = Vec::new();
                let mut acquire = || {
                    install_release_with(
                        product,
                        ReleaseInstallRequest {
                            prefix: &prefix,
                            target: "aarch64-apple-darwin",
                            channel: Channel::Alpha,
                            exact: Some(version),
                        },
                        None,
                        || Ok(()),
                        |url, _, _, _| {
                            assert!(
                                url.starts_with(
                                    "https://github.com/tmt-ninja/tmt/releases/download/"
                                ),
                                "{url}"
                            );
                            calls.push(url.to_owned());
                            Ok(routes.get(url).expect("exact release asset").clone().into())
                        },
                    )
                };
                let report = acquire().unwrap();
                assert!(report.changed);
                let installed = super::super::inspect_product_prefix(product, &prefix).unwrap();
                assert_eq!(installed.state.version.to_string(), version);
                assert_eq!(
                    installed.state.pinned_version,
                    Some(version.parse().unwrap())
                );
                let executable = std::fs::read(&installed.active_executable).unwrap();
                let repeated = acquire().unwrap();
                assert!(!repeated.changed);
                assert_eq!(
                    std::fs::read(&installed.active_executable).unwrap(),
                    executable
                );
                assert_eq!(calls.len(), 6);
                assert!(calls[0].ends_with("/tmt-release-record.json"));
                assert_eq!(&calls[..3], &calls[3..]);
                assert!(!prefix.join("bin/tmt").exists());
            }
        }
    }

    #[test]
    fn exact_first_install_failure_preserves_the_prefix_and_never_falls_back() {
        for defect in [
            "record missing",
            "product",
            "version",
            "tag",
            "manifest",
            "archive",
        ] {
            let directory = TestDirectory::new();
            let prefix = directory.path.join("prefix");
            std::fs::create_dir(&prefix).unwrap();
            let sentinel = prefix.join("user-file");
            std::fs::write(&sentinel, b"unchanged").unwrap();
            let (release, manifest, archive, _) = release::product_fixture(
                Product::Digest,
                "0.1.0-alpha.2",
                "aarch64-apple-darwin",
                42,
            );
            let mut routes = release::indexed_routes(&release, &manifest, &archive);
            let record_url = routes
                .keys()
                .find(|url| url.ends_with("/tmt-release-record.json"))
                .unwrap()
                .clone();
            if matches!(defect, "product" | "version" | "tag") {
                let mut record: serde_json::Value =
                    serde_json::from_slice(&routes[&record_url]).unwrap();
                record[defect] = serde_json::json!(match defect {
                    "product" => "remote",
                    "version" => "0.1.0-alpha.3",
                    _ => "digest-v0.1.0-alpha.3",
                });
                routes.insert(record_url.clone(), serde_json::to_vec(&record).unwrap());
            }
            let mut calls = Vec::new();
            let error = install_release_with(
                Product::Digest,
                ReleaseInstallRequest {
                    prefix: &prefix,
                    target: "aarch64-apple-darwin",
                    channel: Channel::Alpha,
                    exact: Some("0.1.0-alpha.2"),
                },
                None,
                || Ok(()),
                |url, _, _, _| {
                    assert!(
                        url.starts_with("https://github.com/tmt-ninja/tmt/releases/download/"),
                        "{url}"
                    );
                    calls.push(url.to_owned());
                    if defect == "record missing" && url == record_url {
                        return Err(io::Error::new(io::ErrorKind::NotFound, "record absent"));
                    }
                    let mut bytes = routes.get(url).expect("exact release asset").clone();
                    if (defect == "manifest" && url.ends_with("/dist-manifest.json"))
                        || (defect == "archive" && url.ends_with(".tar.gz"))
                    {
                        bytes[0] ^= 1;
                    }
                    Ok(bytes.into())
                },
            )
            .unwrap_err();
            if defect == "record missing" {
                assert!(error.to_string().contains("cannot be installed directly"));
                assert_eq!(calls.len(), 1);
            }
            assert_eq!(std::fs::read(&sentinel).unwrap(), b"unchanged");
            assert_eq!(std::fs::read_dir(&prefix).unwrap().count(), 1);
        }
    }

    #[test]
    fn public_first_install_uses_only_published_hosts_in_both_channels() {
        for product in [Product::Cli, Product::Ops, Product::Remote, Product::Colab] {
            for (version, channel) in [
                ("1.2.4", Channel::Stable),
                ("1.2.4-alpha.2", Channel::Alpha),
            ] {
                for defect in [None, Some("pointer"), Some("archive")] {
                    let directory = TestDirectory::new();
                    let prefix = directory.path.join("prefix");
                    let sentinel = directory.path.join("application-state");
                    std::fs::write(&sentinel, b"untouched state").unwrap();
                    let (release, manifest, archive, _) =
                        release::product_fixture(product, version, "aarch64-apple-darwin", 42);
                    let routes = release::indexed_routes(&release, &manifest, &archive);
                    let network = release::PublishedNetwork::default();
                    let result = install_release_with(
                        product,
                        ReleaseInstallRequest {
                            prefix: &prefix,
                            target: "aarch64-apple-darwin",
                            channel,
                            exact: None,
                        },
                        None,
                        || Ok(()),
                        |url, _, _, _| {
                            network.record(url);
                            if (defect == Some("pointer") && url.contains("/channels/"))
                                || (defect == Some("archive") && url.ends_with(".tar.gz"))
                            {
                                return Err(io::Error::new(
                                    io::ErrorKind::NotFound,
                                    "fixture unavailable",
                                ));
                            }
                            Ok(routes
                                .get(url)
                                .expect("canonical install URL")
                                .clone()
                                .into())
                        },
                    );
                    if defect.is_some() {
                        assert!(result.is_err(), "install / extension install failure");
                        assert!(
                            !prefix.exists(),
                            "failed acquisition must not create a prefix"
                        );
                    } else {
                        let report = result.unwrap();
                        assert!(report.changed);
                        let installed =
                            super::super::inspect_product_prefix(product, &prefix).unwrap();
                        assert_eq!(installed.state.version.to_string(), version);
                        assert_eq!(installed.state.channel, channel);
                        assert_eq!(
                            network.hosts(),
                            [
                                "raw.githubusercontent.com",
                                "github.com",
                                "github.com",
                                "github.com"
                            ],
                            "install / extension install {product:?}"
                        );
                    }
                    assert_eq!(std::fs::read(&sentinel).unwrap(), b"untouched state");
                }
            }
        }
    }

    #[test]
    fn pr_installation_never_falls_back_to_release_discovery_or_creates_a_prefix() {
        let directory = TestDirectory::new();
        let prefix = directory.path.join("prefix");
        let channel = Channel::parse("pr234").unwrap();
        let mut calls = Vec::new();
        let error = install_release_with(
            Product::Cli,
            ReleaseInstallRequest {
                prefix: &prefix,
                target: "aarch64-apple-darwin",
                channel,
                exact: None,
            },
            None,
            || Ok(()),
            |url, _, _, _| {
                calls.push(url.to_owned());
                Err(io::Error::other("PR metadata unavailable"))
            },
        )
        .unwrap_err();
        assert_eq!(error.to_string(), "PR metadata unavailable");
        assert_eq!(
            calls,
            ["https://api.github.com/repos/tmt-ninja/tmt/pulls/234"]
        );
        assert!(!prefix.exists());
        assert!(
            latest_release_version(Product::Cli, channel)
                .unwrap_err()
                .get_ref()
                .unwrap()
                .is::<super::super::pr_resolver::Unavailable>()
        );
    }

    #[test]
    fn no_release_does_not_create_an_installation() {
        let directory = TestDirectory::new();
        let prefix = directory.path.join("prefix");
        let mut calls = 0;
        let error = install_release_with(
            Product::Digest,
            ReleaseInstallRequest { prefix: &prefix, target: "aarch64-apple-darwin", channel: Channel::Alpha, exact: None },
            Some(&|_: &Path, _: &semver::Version| Ok(())),
            || Ok(()),
            |url, _, _, _| {
                calls += 1;
                assert_eq!(
                    url,
                    "https://raw.githubusercontent.com/tmt-ninja/tmt/release-index/channels/digest/alpha.json"
                );
                Err(io::Error::new(io::ErrorKind::NotFound, "pointer missing"))
            },
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert_eq!(calls, 1);
        assert!(!prefix.exists());
    }

    #[test]
    fn unavailable_extension_pointer_never_downloads_another_product_or_creates_a_prefix() {
        for product in [Product::Remote, Product::Colab, Product::Digest] {
            let directory = TestDirectory::new();
            let prefix = directory.path.join("prefix");
            let mut calls = Vec::new();
            let error = install_release_with(product,ReleaseInstallRequest { prefix: &prefix, target: "aarch64-apple-darwin", channel: Channel::Alpha, exact: None },None,||Ok(()),
                |url,_,_,_| {calls.push(url.to_owned()); assert_eq!(url,format!("https://raw.githubusercontent.com/tmt-ninja/tmt/release-index/channels/{}/alpha.json",product.as_str()));
                    Err(io::Error::new(io::ErrorKind::NotFound,"pointer missing"))}).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::NotFound);
            assert_eq!(calls.len(), 1);
            assert!(!prefix.exists());
            assert_eq!(
                error.to_string(),
                format!(
                    "No published {} release in the alpha channel yet. Nothing was changed.",
                    product.as_str()
                )
            );
        }
    }

    #[test]
    fn missing_pointer_or_record_preserves_installation_and_application_state() {
        for (product, version, channel) in [
            (Product::Cli, "1.2.4", Channel::Stable),
            (Product::Digest, "1.2.4-alpha.2", Channel::Alpha),
        ] {
            for at_pointer in [true, false] {
                let directory = TestDirectory::new();
                let prefix = directory.path.join("prefix");
                let sentinel = directory.path.join("application-state");
                std::fs::write(&sentinel, b"untouched").unwrap();
                let (release, manifest, archive, _) =
                    release::product_fixture(product, version, "aarch64-apple-darwin", 42);
                let routes = release::indexed_routes(&release, &manifest, &archive);
                let mut calls = Vec::new();
                let error = install_release_with(
                    product,
                    ReleaseInstallRequest {
                        prefix: &prefix,
                        target: "aarch64-apple-darwin",
                        channel,
                        exact: None,
                    },
                    None,
                    || Ok(()),
                    |url, _, _, _| {
                        calls.push(url.to_owned());
                        if (at_pointer && url.contains("/channels/"))
                            || (!at_pointer && url.ends_with("tmt-release-record.json"))
                        {
                            return Err(io::Error::new(
                                io::ErrorKind::NotFound,
                                "HTTPS resource was not found",
                            ));
                        }
                        Ok(routes
                            .get(url)
                            .expect("canonical metadata URL")
                            .clone()
                            .into())
                    },
                )
                .unwrap_err();
                assert_eq!(error.kind(), io::ErrorKind::NotFound);
                assert_eq!(
                    error.to_string(),
                    if at_pointer {
                        format!(
                            "No published {} release in the {} channel yet. Nothing was changed.",
                            product.as_str(),
                            channel.as_str()
                        )
                    } else {
                        format!(
                            "Could not check for {} updates on raw.githubusercontent.com: Could not download release bytes from github.com: HTTPS resource was not found. Nothing was changed.",
                            product.as_str()
                        )
                    }
                );
                assert_eq!(calls.len(), if at_pointer { 1 } else { 2 });
                assert!(
                    calls.iter().all(|url| url.contains("/channels/")
                        || url.ends_with("tmt-release-record.json"))
                );
                assert!(!prefix.exists());
                assert_eq!(std::fs::read(sentinel).unwrap(), b"untouched");
            }
        }
    }

    #[test]
    fn interruption_before_acquisition_has_no_network_or_filesystem_effect() {
        let directory = TestDirectory::new();
        let prefix = directory.path.join("prefix");
        let error = install_release_with(
            Product::Digest,
            ReleaseInstallRequest {
                prefix: &prefix,
                target: "aarch64-apple-darwin",
                channel: Channel::Alpha,
                exact: None,
            },
            Some(&|_: &Path, _: &semver::Version| Ok(())),
            || Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled")),
            |_, _, _, _| panic!("cancelled installation must not download"),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert!(!prefix.exists());
    }

    #[test]
    fn parallel_discovery_and_prefetch_preserve_order_isolate_failures_and_respect_interrupts() {
        let target = "aarch64-apple-darwin";
        let products = [
            (Product::Ops, "0.1.0-alpha.2"),
            (Product::Remote, "0.1.0-alpha.3"),
            (Product::Colab, "0.1.0-alpha.4"),
            (Product::Digest, "0.1.0-alpha.5"),
        ];
        let mut routes = std::collections::BTreeMap::new();
        for (idx, (product, version)) in products.into_iter().enumerate() {
            let (fixture, manifest, archive, _) =
                release::product_fixture(product, version, target, 100 + idx as u64);
            routes.extend(release::indexed_routes(&fixture, &manifest, &archive));
        }
        // Remove Remote's channel pointer to verify per-product failure isolation.
        let mut discovery_routes = routes.clone();
        discovery_routes.retain(|url, _| !url.contains("/channels/remote/"));

        let requests: Vec<(Product, Channel)> = products
            .iter()
            .map(|(product, _)| (*product, Channel::Alpha))
            .collect();
        let active = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let versions = latest_release_versions_with(
            &requests,
            Instant::now() + Duration::from_secs(10),
            &|url, _, _, _| {
                let now = active.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(now, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(20));
                let out = discovery_routes
                    .get(url)
                    .cloned()
                    .map(Into::into)
                    .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "missing"));
                active.fetch_sub(1, Ordering::SeqCst);
                out
            },
        );
        assert!(
            peak.load(Ordering::SeqCst) >= 2,
            "discovery ran concurrently"
        );
        assert!(peak.load(Ordering::SeqCst) <= MAX_PARALLEL_ACQUISITION);
        assert_eq!(versions[0].as_ref().unwrap().to_string(), "0.1.0-alpha.2");
        assert!(versions[1].is_err());
        assert_eq!(versions[2].as_ref().unwrap().to_string(), "0.1.0-alpha.4");
        assert_eq!(versions[3].as_ref().unwrap().to_string(), "0.1.0-alpha.5");

        // Prefetch with one missing archive isolates failure and preserves order.
        let mut fetch_routes = routes.clone();
        fetch_routes.retain(|url, _| !(url.contains("colab") && url.ends_with(".tar.gz")));
        let fetch_reqs: Vec<PrefetchRequest> = products
            .iter()
            .map(|(product, version)| PrefetchRequest {
                product: *product,
                channel: Channel::Alpha,
                version: (*version).into(),
                target: target.into(),
            })
            .collect();
        let fetched = prefetch_releases_with(
            &fetch_reqs,
            Instant::now() + Duration::from_secs(10),
            &|| false,
            &|url, _, _, _| {
                fetch_routes
                    .get(url)
                    .cloned()
                    .map(Into::into)
                    .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "missing archive"))
            },
        );
        assert_eq!(fetched[0].as_ref().unwrap().product(), Product::Ops);
        assert_eq!(fetched[1].as_ref().unwrap().product(), Product::Remote);
        assert!(fetched[2].is_err());
        assert_eq!(fetched[3].as_ref().unwrap().product(), Product::Digest);

        // Interrupt stops prefetch cleanly without network IO.
        let interrupted = prefetch_releases_with(
            &fetch_reqs,
            Instant::now() + Duration::from_secs(10),
            &|| true,
            &|_, _, _, _| panic!("interrupted prefetch must not perform network IO"),
        );
        assert!(interrupted.iter().all(|res| {
            res.as_ref()
                .is_err_and(|e| e.kind() == io::ErrorKind::Interrupted)
        }));
    }

    #[test]
    fn loopback_fixture_benchmark_serial_vs_parallel() {
        let target = "aarch64-apple-darwin";
        let products = [
            (Product::Ops, "0.1.0-alpha.2"),
            (Product::Remote, "0.1.0-alpha.3"),
            (Product::Colab, "0.1.0-alpha.4"),
            (Product::Digest, "0.1.0-alpha.5"),
        ];
        let mut routes = std::collections::BTreeMap::new();
        for (idx, (product, version)) in products.into_iter().enumerate() {
            let (fixture, manifest, archive, _) =
                release::product_fixture(product, version, target, 200 + idx as u64);
            routes.extend(release::indexed_routes(&fixture, &manifest, &archive));
        }
        let latency = Duration::from_millis(25);
        let get = |url: &str, _: &str, _: usize, _: Instant| {
            std::thread::sleep(latency);
            routes
                .get(url)
                .cloned()
                .map(Into::into)
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "missing"))
        };
        let deadline = Instant::now() + Duration::from_secs(30);

        // Before: serial discovery (twice, as plan_child previously re-ran --plan) + serial downloads.
        let t_serial = Instant::now();
        for _ in 0..2 {
            for (product, _) in products {
                let (_, v) = release::discover_latest(
                    product,
                    Channel::Alpha,
                    deadline,
                    &mut |u, a, l, d| get(u, a, l, d),
                )
                .unwrap();
                assert!(!v.to_string().is_empty());
            }
        }
        for (product, version) in products {
            let v: Version = version.parse().unwrap();
            let dl = release::download_product_observed(
                product,
                Channel::Alpha,
                Some(&v),
                target,
                deadline,
                |u, a, l, d| get(u, a, l, d),
                &|_| {},
            )
            .unwrap();
            assert_eq!(dl.version, v);
        }
        let serial_ms = t_serial.elapsed().as_millis();

        // After: discover once in bounded parallel + bounded parallel pre-download.
        let t_parallel = Instant::now();
        let reqs: Vec<(Product, Channel)> =
            products.iter().map(|(p, _)| (*p, Channel::Alpha)).collect();
        let discovered = latest_release_versions_with(&reqs, deadline, &get);
        assert!(discovered.iter().all(Result::is_ok));
        let fetch_reqs: Vec<PrefetchRequest> = products
            .iter()
            .map(|(p, v)| PrefetchRequest {
                product: *p,
                channel: Channel::Alpha,
                version: (*v).into(),
                target: target.into(),
            })
            .collect();
        let prefetched = prefetch_releases_with(&fetch_reqs, deadline, &|| false, &get);
        assert!(prefetched.iter().all(Result::is_ok));
        let parallel_ms = t_parallel.elapsed().as_millis();

        eprintln!(
            "6912-benchmark (4 extensions, 25ms/req): serial={serial_ms}ms parallel={parallel_ms}ms"
        );
    }
}
