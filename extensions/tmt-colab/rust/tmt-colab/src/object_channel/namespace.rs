//! Root-local namespace management. A deleted page's signed policy survives its
//! payloads; only that committed tombstone admits removing its object namespace.
use super::{CallbackOwner, ChannelOwner, Client};
use crate::{Result, attachments, fold, management::Storage, page, page::save::SourceOpener};
use std::{sync::Arc, time::Instant};
use tmt_colab_model::values;
/// A committed original as the namespace listing names it.
pub(crate) use tmt_extension_objects::Listed;
use tmt_extension_objects::{
    Admit, AdmitInput, Bytes32, Call, Context, Decision, Disclosure, ErrorCode, LIST_ENTRIES,
    ListInput, Method, NamespaceInput, Origin, Outcome, RemoveInput, Success, Usage, UsageScope,
};

/// Verify the retained membership log rather than opening deleted payloads.
fn policy(source: &SourceOpener, page: &str) -> Result<(String, bool)> {
    values::generated_id(page)?;
    let view = source()?;
    policy_view(&view, page)
}
fn policy_view(view: &page::save::Source, page: &str) -> Result<(String, bool)> {
    let deleted =
        view.store
            .owner_read(&view.keyring.space_id, &view.keyring.owner_public(), |tx| {
                let (states, _) = fold::verify_log(&tx.log()?, &view.keyring, page)?;
                let authority = states.last().ok_or(page::Fault::Invalid)?;
                if tx.head() != Some(&authority.head) || !tx.pages()?.iter().any(|id| id == page) {
                    return Err(page::Fault::Invalid.into());
                }
                Ok(authority.policy.deleted)
            })?;
    Ok((view.keyring.space_id.clone(), deleted))
}

struct Admission {
    client: Client,
    source: SourceOpener,
    page: String,
    namespace: Bytes32,
    removing: bool,
}
impl CallbackOwner for Admission {
    fn decide(&self, admit: &Admit, deadline: Instant) -> Decision {
        let input = match &admit.operation.input {
            AdmitInput::RemoveNamespace(value) => {
                self.removing && value.namespace == self.namespace
            }
            AdmitInput::Usage(UsageScope::Namespace(value)) => {
                !self.removing && *value == self.namespace
            }
            _ => false,
        };
        let disclosure = match admit.operation.disclosure {
            None => true,
            Some(Disclosure::Removed) => self.removing,
            Some(Disclosure::Usage(_)) => !self.removing,
            _ => false,
        };
        let current = policy(&self.source, &self.page).is_ok_and(|(space, deleted)| {
            (!self.removing || deleted)
                && attachments::namespace(&space, &self.page)
                    .is_ok_and(|value| Bytes32::from_bytes(value) == self.namespace)
        });
        if input
            && disclosure
            && current
            && Instant::now() < deadline
            && admit.generation == self.client.generation()
            && admit.context == Context::LocalExtension
            && self.client.standing(Origin::LocalExtension)
        {
            Decision::Allow
        } else {
            Decision::Deny
        }
    }
}

impl ChannelOwner {
    /// One bounded, rotating pass over retained committed tombstones. The
    /// maintenance worker resets `after` when a fresh channel is established.
    pub(crate) fn sweep_deletions(
        &self,
        source: &SourceOpener,
        view: &page::save::Source,
        after: &mut Option<String>,
        deadline: Instant,
    ) -> Result<bool> {
        let pages =
            view.store
                .owner_read(&view.keyring.space_id, &view.keyring.owner_public(), |tx| {
                    tx.pages()
                })?;
        let mut unfinished = false;
        for (checked, page) in pages
            .iter()
            .filter(|page| after.as_ref().is_none_or(|last| *page > last))
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .enumerate()
        {
            if checked == 4 || Instant::now() >= deadline {
                return Ok(true);
            }
            *after = Some(page.clone());
            match policy_view(view, &page) {
                Ok((_, true)) => {
                    unfinished |=
                        self.remove_page_namespace(&page, source, deadline) != Storage::Freed;
                }
                Ok((_, false)) => {}
                Err(_) => unfinished = true,
            }
        }
        *after = None;
        Ok(unfinished)
    }

    /// Whether the active channel can list objects (Remote version 4).
    pub(crate) fn lists_objects(&self) -> bool {
        self.client()
            .is_some_and(|client| client.supports(Method::List).unwrap_or(false))
    }
    /// Read this page's namespace allocation without making it a reclaim dependency.
    pub(crate) fn storage_usage(
        &self,
        page: &str,
        source: &SourceOpener,
        deadline: Instant,
    ) -> attachments::UsageDetails {
        match self.client() {
            Some(client) => client.usage_details(page, source, deadline),
            None => attachments::UsageDetails::Unknown,
        }
    }

    pub(crate) fn remove_page_namespace(
        &self,
        page: &str,
        source: &SourceOpener,
        deadline: Instant,
    ) -> Storage {
        let Ok((space, true)) = policy(source, page) else {
            return Storage::Pending;
        };
        let Some(client) = self.client() else {
            return Storage::Pending;
        };
        match client.supports(Method::RemoveNamespace) {
            Ok(true) => {}
            Ok(false) => return Storage::Unsupported,
            Err(_) => return Storage::Pending,
        }
        let Ok(namespace) = attachments::namespace(&space, page) else {
            return Storage::Pending;
        };
        let namespace = Bytes32::from_bytes(namespace);
        let owner = Arc::new(Admission {
            client: client.clone(),
            source: source.clone(),
            page: page.into(),
            namespace,
            removing: true,
        });
        match client.request(
            Origin::LocalExtension,
            Call::RemoveNamespace(NamespaceInput { namespace }),
            owner,
            deadline,
        ) {
            Ok(Outcome::Success(Success::Removed)) => Storage::Freed,
            Ok(Outcome::Failure(tmt_extension_objects::ErrorCode::Unknown)) | Err(_) => {
                Storage::Unknown
            }
            _ => Storage::Pending,
        }
    }
}
impl Client {
    pub(crate) fn usage_details(
        &self,
        page: &str,
        source: &SourceOpener,
        deadline: Instant,
    ) -> attachments::UsageDetails {
        match self.namespace_usage(page, source, deadline) {
            Ok(Some(value)) => value.into(),
            Ok(None) => attachments::UsageDetails::Unsupported {
                hint: tmt_extension_objects::unsupported_hint().into(),
            },
            Err(_) => attachments::UsageDetails::Unknown,
        }
    }
    fn namespace_usage(
        &self,
        page: &str,
        source: &SourceOpener,
        deadline: Instant,
    ) -> Result<Option<Usage>> {
        let (space, _) = policy(source, page)?;
        let client = self;
        if !client.supports(Method::Usage)? {
            return Ok(None);
        }
        let namespace = Bytes32::from_bytes(attachments::namespace(&space, page)?);
        let owner = Arc::new(Admission {
            client: client.clone(),
            source: source.clone(),
            page: page.into(),
            namespace,
            removing: false,
        });
        match client.request(
            Origin::LocalExtension,
            Call::Usage(UsageScope::Namespace(namespace)),
            owner,
            deadline,
        ) {
            Ok(Outcome::Success(Success::Usage(value))) => Ok(Some(value)),
            _ => Err(page::Fault::Unavailable.into()),
        }
    }
}

impl From<tmt_extension_objects::Usage> for attachments::UsageDetails {
    fn from(value: tmt_extension_objects::Usage) -> Self {
        Self::Known {
            charged_bytes: value.charged_bytes,
            entries: value.entries,
            active_uploads: value.active_uploads,
            retained_identities: value.retained_identities,
        }
    }
}

/// Whether this page's attachments may be removed when unreferenced now: a current-history,
/// non-public, writable page (not archived, not deleted). History-mode shares, public pages,
/// archived pages and tombstones keep every object.
pub(crate) fn removal_eligible(view: &page::save::Source, page: &str) -> Result<bool> {
    values::generated_id(page)?;
    view.store
        .owner_read(&view.keyring.space_id, &view.keyring.owner_public(), |tx| {
            let revision = tx.head().ok_or(page::Fault::Invalid)?.revision;
            if !tx.pages()?.iter().any(|id| id == page) {
                return Ok(false);
            }
            let policy = tx.page_policy_at(page, revision)?;
            Ok(policy.writable() && policy.history_current && !policy.public_mode)
        })
}

/// What a per-object removal asked Remote and what it may still allow. The page fence is
/// checked again at each callback, so a write that lands after the reference set was
/// computed refuses the removal before its effect.
struct ObjectAdmission {
    client: Client,
    source: SourceOpener,
    page: String,
    namespace: Bytes32,
    input: Option<RemoveInput>,
    fence: Option<[u8; 32]>,
}
impl CallbackOwner for ObjectAdmission {
    fn decide(&self, admit: &Admit, deadline: Instant) -> Decision {
        let input = match (&admit.operation.input, &self.input) {
            (AdmitInput::Remove(value), Some(expected)) => value == expected,
            (AdmitInput::List(value), None) => value.namespace == self.namespace,
            _ => false,
        };
        let disclosure = match admit.operation.disclosure {
            None => true,
            Some(Disclosure::Removed) => self.input.is_some(),
            Some(Disclosure::Listed { .. }) => self.input.is_none(),
            _ => false,
        };
        let current = (self.source)().is_ok_and(|view| {
            removal_eligible(&view, &self.page).unwrap_or(false)
                && attachments::namespace(&view.keyring.space_id, &self.page)
                    .is_ok_and(|value| Bytes32::from_bytes(value) == self.namespace)
                && self
                    .fence
                    .is_none_or(|fence| view.store.page_fence(&self.page).ok() == Some(fence))
        });
        if input
            && disclosure
            && current
            && Instant::now() < deadline
            && admit.generation == self.client.generation()
            && admit.context == Context::LocalExtension
            && self.client.standing(Origin::LocalExtension)
        {
            Decision::Allow
        } else {
            Decision::Deny
        }
    }
}

/// How one per-object removal ended. Only `Removed` says the payload and its charge are gone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ObjectRemoval {
    Removed,
    /// Refused before any effect (a moved fence, a changed page or a conflicting original).
    Refused,
    /// The effect may have happened; the next pass sees whether it is still listed.
    Unknown,
    /// No channel, a busy channel or a version-3 link: nothing was asked.
    Unavailable,
}
impl Client {
    /// Every committed object of the page's namespace, in key order, within `pages` pages of
    /// [`LIST_ENTRIES`]. `None` when the link has no listing (a Remote before version 4).
    pub(crate) fn list_objects(
        &self,
        page: &str,
        source: &SourceOpener,
        pages: usize,
        deadline: Instant,
    ) -> Result<Option<Vec<Listed>>> {
        if !self.supports(Method::List)? {
            return Ok(None);
        }
        let space = source()?.keyring.space_id.clone();
        let namespace = Bytes32::from_bytes(attachments::namespace(&space, page)?);
        let owner = Arc::new(ObjectAdmission {
            client: self.clone(),
            source: source.clone(),
            page: page.into(),
            namespace,
            input: None,
            fence: None,
        });
        let mut entries = Vec::new();
        let mut after = None;
        for _ in 0..pages {
            match self.request(
                Origin::LocalExtension,
                Call::List(ListInput {
                    namespace,
                    after,
                    limit: LIST_ENTRIES,
                }),
                Arc::clone(&owner) as Arc<dyn CallbackOwner>,
                deadline,
            ) {
                Ok(Outcome::Success(Success::Listed(listing))) => {
                    entries.extend(listing.entries);
                    match listing.next {
                        Some(next) => after = Some(next),
                        None => return Ok(Some(entries)),
                    }
                }
                _ => return Err(page::Fault::Unavailable.into()),
            }
        }
        // More objects than the bounded pass may look at: an incomplete listing decides nothing.
        Err(page::Fault::Unavailable.into())
    }
    /// Ask Remote to remove one listed object, admitted only while the page still has `fence`.
    pub(crate) fn remove_object(
        &self,
        page: &str,
        source: &SourceOpener,
        listed: &Listed,
        fence: [u8; 32],
        deadline: Instant,
    ) -> ObjectRemoval {
        match self.supports(Method::Remove) {
            Ok(true) => {}
            _ => return ObjectRemoval::Unavailable,
        }
        let Ok(space) = source().map(|view| view.keyring.space_id.clone()) else {
            return ObjectRemoval::Unavailable;
        };
        let Ok(namespace) = attachments::namespace(&space, page).map(Bytes32::from_bytes) else {
            return ObjectRemoval::Unavailable;
        };
        let input = RemoveInput {
            namespace,
            opaque_key: listed.opaque_key,
            payload_sha256: listed.payload_sha256,
            payload_bytes: listed.payload_bytes,
        };
        let owner = Arc::new(ObjectAdmission {
            client: self.clone(),
            source: source.clone(),
            page: page.into(),
            namespace,
            input: Some(input.clone()),
            fence: Some(fence),
        });
        match self.request(Origin::LocalExtension, Call::Remove(input), owner, deadline) {
            Ok(Outcome::Success(Success::Removed)) => ObjectRemoval::Removed,
            Ok(Outcome::Failure(ErrorCode::Unknown)) | Err(_) => ObjectRemoval::Unknown,
            Ok(Outcome::Failure(ErrorCode::Unavailable)) => ObjectRemoval::Unavailable,
            _ => ObjectRemoval::Refused,
        }
    }
}
