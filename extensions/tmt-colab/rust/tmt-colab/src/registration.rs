//! Owner-browser extension-key registration. Remote authenticates the device;
//! this boundary verifies both extension-key certificates before any signing.
use crate::{
    Result,
    keyring::Keyring,
    store::{
        Store,
        owner::{Device, Mutation, OwnerTransaction},
    },
    transitions::Engine,
};
use serde::{Deserialize, Serialize};
use tmt_colab_model::{certificate, crypto, framing, statement, values};

pub const PATH: &str = "/api/devices/register";
pub const FRESHNESS_MS: u64 = 10 * 60 * 1000;
pub const CERTIFICATE_MS: u64 = 365 * 24 * 60 * 60 * 1000;
pub const RENEWAL_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const GENESIS: &str = "00000000-0000-4000-8000-000000000001";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Code {
    Invalid,
    Denied,
    Expired,
    Conflict,
    Unavailable,
    Capacity,
}
impl Code {
    pub fn status(self) -> u16 {
        match self {
            Self::Invalid => 400,
            Self::Denied | Self::Expired => 403,
            Self::Conflict => 409,
            Self::Unavailable | Self::Capacity => 503,
        }
    }
    pub fn text(self) -> &'static str {
        match self {
            Self::Invalid => "INVALID",
            Self::Denied => "DENIED",
            Self::Expired => "EXPIRED",
            Self::Conflict => "CONFLICT",
            Self::Unavailable => "UNAVAILABLE",
            Self::Capacity => "CAPACITY",
        }
    }
}
impl std::fmt::Display for Code {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.text())
    }
}
impl std::error::Error for Code {}
impl From<tmt_colab_model::Invalid> for Code {
    fn from(_: tmt_colab_model::Invalid) -> Self {
        Self::Invalid
    }
}

/// Trusted only when read from remote's header on the owner-only mount socket.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Context {
    device_id: String,
    kind: String,
    origin: String,
    name: String,
    public_key: String,
    owner: bool,
    grant_revision: u64,
}
pub(crate) const WORK_NUMBERS_PATH: &str = "/api/work-numbers";
/// What the describing Remote admits (`tmt-describe-features`); an older Remote names none and
/// gets the primary-only answer.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct DescribeFeatures {
    pub modules: bool,
    pub home: bool,
}
impl DescribeFeatures {
    pub(crate) fn parse(header: Option<&str>) -> Self {
        let has = |name: &str| {
            header.is_some_and(|features| features.split(',').any(|token| token.trim() == name))
        };
        Self {
            modules: has("modules"),
            home: has("home"),
        }
    }
}
pub(crate) const WORK_FACTS_PATH: &str = "/api/work-facts";
/// Work home's owner-activity batch (#6474).
pub(crate) const WORK_ACTIVITY_PATH: &str = "/api/work-activity";

pub mod ipc {
    /// Root-local owner-list read, admitted by the private socket.
    pub const PAGE_LIST_PATH: &str = "/.tmt/colab/local/page-list";
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WorkNumbersRequest {
    page_id: String,
    blocks: Vec<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WorkFactsRequest {
    exclusion: Option<TitleExclusion>,
    page_id: String,
    block_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TitleExclusion {
    pub url: String,
    pub ignore: bool,
}

pub(crate) struct WorkFactsInput {
    pub exclusion: Option<TitleExclusion>,
    pub device: String,
    pub page: String,
    pub projection: Option<crate::summary::SummaryProjection>,
    pub never_written: bool,
    pub last_activity_at_ms: Option<u64>,
    pub prefix: Option<String>,
    pub repository: Option<String>,
    pub numbers: Vec<String>,
    pub numbered_blocks: std::collections::BTreeMap<String, String>,
    pub block: Option<String>,
    pub number: Option<String>,
    pub fingerprint: String,
}
impl Context {
    fn parse(raw: Option<&str>) -> std::result::Result<Self, Code> {
        let c: Self = serde_json::from_str(raw.ok_or(Code::Denied)?).map_err(|_| Code::Denied)?;
        if !c.owner
            || c.grant_revision == 0
            || !matches!(c.kind.as_str(), "browser" | "addon" | "cli")
        {
            return Err(Code::Denied);
        }
        values::generated_id(&c.device_id).map_err(|_| Code::Denied)?;
        c.key()?;
        Ok(c)
    }
    fn key(&self) -> std::result::Result<[u8; 32], Code> {
        let key = binary::<32>(&self.public_key).map_err(|_| Code::Denied)?;
        crypto::public_key(&key).map_err(|_| Code::Denied)?;
        Ok(key)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Request {
    device_id: String,
    sign: KeyCertificate,
    enc: KeyCertificate,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct KeyCertificate {
    public_key: String,
    issued_at_ms: u64,
    signature: String,
}
fn binary<const N: usize>(text: &str) -> std::result::Result<[u8; N], Code> {
    values::binary(text, N)?
        .try_into()
        .map_err(|_| Code::Invalid)
}
/// Remote owns this layout (canonical::ext_cert); the shared model LP primitive
/// implements its byte rules without importing a Remote behavior dependency.
fn ext_cert(purpose: &str, key: &[u8; 32], issued: u64) -> std::result::Result<Vec<u8>, Code> {
    values::time(issued)?;
    Ok(framing::frame(&[
        b"tmt-ext-cert-v1",
        b"colab",
        purpose.as_bytes(),
        key,
        issued.to_string().as_bytes(),
    ])?)
}
impl KeyCertificate {
    fn verify(
        &self,
        purpose: &str,
        context: &[u8; 32],
        now: u64,
    ) -> std::result::Result<[u8; 32], Code> {
        let key = binary(&self.public_key)?;
        let signature = binary::<64>(&self.signature)?;
        let input = ext_cert(purpose, &key, self.issued_at_ms)?;
        if self.issued_at_ms > now || now - self.issued_at_ms > FRESHNESS_MS {
            return Err(Code::Expired);
        }
        crypto::verify_signature(context, &input, &signature).map_err(|_| Code::Denied)?;
        if purpose == "sign" {
            crypto::public_key(&key)?;
        }
        if purpose == "enc" && key == [0; 32] {
            return Err(Code::Invalid);
        }
        Ok(key)
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct DeviceRegistration {
    context: Context,
    signing: [u8; 32],
    encryption: [u8; 32],
    outcome: Vec<u8>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Revocation {
    Unchanged,
    Tombstoned,
    MembershipChanged,
}

/// A projected title (already one line of display text) cut to a card's length, ending in an
/// ellipsis when cut.
fn card_title(title: &str) -> String {
    if title.chars().count() <= CARD_TITLE_SCALARS {
        return title.to_owned();
    }
    let kept: String = title.chars().take(CARD_TITLE_SCALARS - 1).collect();
    format!("{}\u{2026}", kept.trim_end())
}

/// Recent pages Colab offers the TMT web shell's Home.
const HOME_CARDS: usize = 5;
/// A Home card's title, in Unicode scalars, ellipsis included.
const CARD_TITLE_SCALARS: usize = 40;

/// What one browser catalog read holds, read in one store transaction.
/// The page list's change token: a digest of every page's fingerprint, in page order.
fn list_token(
    fingerprints: &std::collections::BTreeMap<String, String>,
) -> std::result::Result<String, Code> {
    let parts: Vec<&[u8]> = std::iter::once(b"tmt-colab-page-list-v1".as_slice())
        .chain(
            fingerprints
                .iter()
                .flat_map(|(page, print)| [page.as_bytes(), print.as_bytes()]),
        )
        .collect();
    let digest = crypto::digest(&framing::frame(&parts).map_err(|_| Code::Unavailable)?);
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}
/// A listed page's content revision (contract: Live page list): a digest of its progress, the
/// fingerprint without the membership head, so it moves when the page's own content does and not
/// when another page is created, shared or archived. Opaque to the browser, and never a write fence.
fn content_revision(page: &str, progress: &str) -> std::result::Result<String, Code> {
    let parts: [&[u8]; 3] = [
        b"tmt-colab-page-content-v1",
        page.as_bytes(),
        progress.as_bytes(),
    ];
    let digest = crypto::digest(&framing::frame(&parts).map_err(|_| Code::Unavailable)?);
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}
struct CatalogRead {
    catalog: serde_json::Value,
    fingerprints: std::collections::BTreeMap<String, String>,
    /// The local titles still valid for their page (`page_titles`).
    titles: std::collections::BTreeMap<String, String>,
    /// Each listed page's revision token, the one `page read` returns, except a frozen page's
    /// (`page::listed_token`).
    revisions: std::collections::BTreeMap<String, String>,
    /// Each page's progress (`page_progress`): its fingerprint without the membership head.
    progress: std::collections::BTreeMap<String, String>,
}

pub struct Registration {
    store: Store,
    keyring: Keyring,
    engine: Engine,
    readers: crate::readers::Sessions,
    reader_clock: std::sync::Arc<dyn Fn() -> std::result::Result<u64, Code> + Send + Sync>,
    save_source: Option<crate::page::save::SourceOpener>,
    order_source: Option<crate::page::save::SourceOpener>,
    /// The owner list's display-only page summaries; filled in the background, never signed.
    summaries: std::sync::Arc<crate::summary::SummaryCache>,
    /// How the background refresh opens its own read-only source; without it no summary is made.
    summary_source: Option<crate::page::save::SourceOpener>,
    /// The page list token at a store write generation: a held read's idle check reuses it while
    /// nothing was written, instead of digesting every page's fingerprint again.
    list_token: std::cell::RefCell<Option<(crate::store::WriteGeneration, String)>>,
    /// The serve's owner-activity observations, shared with the socket's reads; the list only
    /// reads what is retained (#6474).
    work_facts: Option<std::sync::Arc<crate::work_facts::Facts>>,
}
impl Registration {
    pub fn new(
        store: Store,
        keyring: Keyring,
        decoder_program: std::path::PathBuf,
    ) -> Result<Self> {
        Self::with_decoder_config(store, keyring, crate::decoder::Config::new(decoder_program))
    }
    pub fn with_decoder_config(
        store: Store,
        keyring: Keyring,
        decoder_config: crate::decoder::Config,
    ) -> Result<Self> {
        Ok(Self {
            store,
            keyring,
            engine: Engine::with_decoder_config(decoder_config)?,
            readers: Default::default(),
            reader_clock: std::sync::Arc::new(now_ms),
            save_source: None,
            order_source: None,
            summaries: Default::default(),
            summary_source: None,
            work_facts: None,
            list_token: Default::default(),
        })
    }
    /// The owner's template list (`GET /api/templates`, #5077): admitted as the page list is, read
    /// by the caller outside this mutex through the returned source.
    pub fn templates_source(
        &self,
        context: Option<&str>,
    ) -> std::result::Result<crate::page::save::SourceOpener, Code> {
        Context::parse(context)?;
        self.save_source.clone().ok_or(Code::Unavailable)
    }
    /// Every template and the serving machine's default, as `template ls --json` lists them.
    pub fn templates(open: &crate::page::save::SourceOpener) -> std::result::Result<Vec<u8>, Code> {
        let mut source = open().map_err(|_| Code::Unavailable)?;
        let catalog = crate::template_catalog::catalog(
            &source.layout,
            &source.store,
            &source.keyring,
            &mut source.decoder,
        )
        .map_err(|_| Code::Unavailable)?;
        let settings = crate::settings::read_or_default(&source.root);
        let listing = crate::template_catalog::listing(&catalog, settings.default_template())
            .map_err(|_| Code::Unavailable)?;
        serde_json::to_vec(&listing).map_err(|_| Code::Unavailable)
    }
    pub(crate) fn space_id(&self) -> &str {
        &self.keyring.space_id
    }
    /// The owner's membership head now: none before the space's first statement.
    pub(crate) fn owner_head(&self) -> crate::Result<Option<tmt_colab_model::statement::Head>> {
        self.store
            .owner_head(&self.keyring.space_id, &self.keyring.owner_public())
    }
    /// The page's current epoch, to name it when the cloud worker is asked to look at it again.
    pub fn page_epoch(&self, page: &str) -> Option<u64> {
        self.store
            .owner_read(&self.keyring.space_id, &self.keyring.owner_public(), |tx| {
                tx.page_epoch(page)
            })
            .ok()?
            .and_then(|epoch| epoch.parse().ok())
    }
    /// Server-owned reader clock, injected for deterministic expiry verification.
    pub fn with_reader_clock(
        mut self,
        clock: impl Fn() -> std::result::Result<u64, Code> + Send + Sync + 'static,
    ) -> Self {
        self.reader_clock = std::sync::Arc::new(clock);
        self
    }
    pub(crate) fn reader_request(
        &mut self,
        path: &str,
        body: &[u8],
    ) -> std::result::Result<Vec<u8>, Code> {
        let now = (self.reader_clock)()?;
        if path == crate::readers::CHALLENGE_PATH {
            self.readers
                .challenge(&self.store, &self.keyring, body, now)
        } else {
            self.readers
                .exchange(&mut self.store, &self.keyring, body, now)
        }
    }
    pub(crate) fn reader_upgrade(
        &mut self,
        token: &[u8; 32],
    ) -> std::result::Result<(String, String), Code> {
        self.readers
            .upgrade(&self.store, &self.keyring, token, (self.reader_clock)()?)
    }
    pub(crate) fn release_reader(&mut self, id: &str) {
        self.readers.release(id);
    }
    /// Waits for the background summary fold first: its title writes go to the same store.
    pub fn close(self) -> Result<()> {
        self.summaries.close();
        self.store.close()
    }
    /// Read-only owner discovery also works before extension-key registration.
    pub fn session(context: Option<&str>) -> std::result::Result<Vec<u8>, Code> {
        let c = Context::parse(context)?;
        serde_json::to_vec(
            &serde_json::json!({"deviceId":c.device_id,"publicKey":c.public_key,
            "grantRevision":c.grant_revision.to_string(),"name":c.name}),
        )
        .map_err(|_| Code::Unavailable)
    }
    /// The owner's page list. Each page carries the summary the cache holds for its current
    /// fingerprint, and pages without one are scheduled for a bounded background refresh: this
    /// read replies at once with whatever is fresh and never waits for the fold. A page's work and
    /// its parent are resolved here across the fresh pages, never cached: they change when another
    /// page does.
    pub fn pages(&self, context: Option<&str>) -> std::result::Result<Vec<u8>, Code> {
        Context::parse(context)?;
        self.project_pages(true, false)
    }

    pub(crate) fn local_pages(&self) -> std::result::Result<Vec<u8>, Code> {
        self.project_pages(true, true)
    }

    /// The native caller holds the owner lifecycle lock and opens a read-only source.
    pub fn offline_pages(
        mut source: crate::page::save::Source,
        decoder_program: std::path::PathBuf,
    ) -> Result<Vec<u8>> {
        let (catalog, fingerprints) = source.store.owner_read(
            &source.keyring.space_id,
            &source.keyring.owner_public(),
            |tx| Ok((tx.page_list()?, tx.page_fingerprints()?)),
        )?;
        let cache = std::sync::Arc::new(crate::summary::SummaryCache::default());
        let order = crate::summary::recent_first(&catalog, &fingerprints);
        crate::summary::run(&cache, &order, |page, _| {
            crate::summary::summarize_details(&mut source, page)
        });
        let mut service = Self::new(source.store, source.keyring, decoder_program)?;
        service.summaries = cache;
        service
            .project_pages(false, true)
            .map_err(|code| std::io::Error::other(code.text()).into())
    }

    fn project_pages(
        &self,
        serving: bool,
        section_progress: bool,
    ) -> std::result::Result<Vec<u8>, Code> {
        let mut catalog = self.work_catalog(true, serving, section_progress)?;
        let orders = self.visible_project_orders(&catalog)?;
        // The mandatory omitted-name list has already been budgeted. Moving a name from
        // that array into the map pays for the name itself; allow for the colon and comma.
        let mut used = serde_json::to_vec(&catalog)
            .map_err(|_| Code::Unavailable)?
            .len();
        let mut included = serde_json::Map::new();
        let mut omitted = Vec::new();
        for (name, order) in orders {
            let value = serde_json::to_value(order).map_err(|_| Code::Unavailable)?;
            let cost = serde_json::to_vec(&value)
                .map_err(|_| Code::Unavailable)?
                .len()
                + 2;
            if used.saturating_add(cost) <= crate::limits::DISCOVERY_BYTES {
                included.insert(name, value);
                used += cost;
            } else {
                omitted.push(name);
            }
        }
        catalog["projectOrders"] = included.into();
        catalog["projectOrdersOmitted"] = omitted.into();
        // Send repository hints only in the mounted owner's bounded catalog.
        if serving && !section_progress {
            let repositories = self
                .store
                .project_repositories()
                .map_err(|error| map_error(error.into()))?;
            let mut used = serde_json::to_vec(&catalog)
                .map_err(|_| Code::Unavailable)?
                .len();
            for page in catalog["pages"].as_array_mut().into_iter().flatten() {
                let Some(repository) = page["projects"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(serde_json::Value::as_str)
                    .filter(|name| repositories.contains_key(*name))
                    .min()
                    .and_then(|name| repositories.get(name))
                else {
                    continue;
                };
                let cost = repository.len() + 24;
                if used.saturating_add(cost) <= crate::limits::DISCOVERY_BYTES {
                    page["ticketRepository"] = serde_json::json!(repository);
                    used += cost;
                }
            }
        }
        let bytes = serde_json::to_vec(&catalog).map_err(|_| Code::Unavailable)?;
        if bytes.len() > crate::limits::DISCOVERY_BYTES {
            return Err(Code::Capacity);
        }
        Ok(bytes)
    }

    /// A root-local offline invocation folds just the pages referenced by this order.
    pub fn with_order_source(mut self, open: crate::page::save::SourceOpener) -> Self {
        self.order_source = Some(open);
        self
    }

    fn prepare_order(&self, name: &str, extra: &[&str]) -> Result<()> {
        let Some(open) = self.order_source.as_ref().or(self.summary_source.as_ref()) else {
            return Ok(());
        };
        let order = self.store.project_order(name)?;
        let ids: std::collections::BTreeSet<_> = order
            .items
            .iter()
            .map(String::as_str)
            .chain(extra.iter().copied())
            .map(|id| id.split_once(':').map_or(id, |(page, _)| page))
            .collect();
        if ids.is_empty() {
            return Ok(());
        }
        let fingerprints =
            self.store
                .owner_read(&self.keyring.space_id, &self.keyring.owner_public(), |tx| {
                    tx.page_fingerprints()
                })?;
        let mut source = None;
        let mut title_writer = None;
        for page in ids {
            let Some(fingerprint) = fingerprints.get(page) else {
                continue;
            };
            if self.summaries.get(page, fingerprint).is_some() {
                continue;
            }
            let read = match &mut source {
                Some(source) => source,
                slot @ None => slot.insert(open()?),
            };
            let titles = title_writer
                .get_or_insert_with(|| crate::page_titles::TitleWriter::new(&read.layout));
            let projection = crate::summary::summarize_current(read, titles, page, fingerprint)?;
            self.summaries.put(page, fingerprint, Some(projection));
        }
        Ok(())
    }

    pub(crate) fn show_work_order(
        &self,
        name: &str,
    ) -> Result<(
        crate::store::project_orders::ProjectOrder,
        Vec<serde_json::Value>,
    )> {
        self.prepare_order(name, &[])?;
        let catalog = self
            .work_catalog(false, self.order_source.is_none(), false)
            .map_err(|code| std::io::Error::other(code.text()))?;
        let membership = crate::store::project_orders::WorkMembership::from_catalog(&catalog);
        let order = self
            .store
            .project_order(name)?
            .visible(&|key| membership.classify(name, key));
        let labels = order.items.iter().map(|id| membership.label(id)).collect();
        Ok((order, labels))
    }

    pub(crate) fn change_work_order(
        &mut self,
        project: &str,
        revision: i64,
        item: &str,
        position: &crate::store::project_orders::Position,
    ) -> Result<crate::store::project_orders::MoveOutcome> {
        let mut extra = vec![item];
        if let crate::store::project_orders::Position::Before(anchor) = position {
            extra.push(anchor);
        }
        self.prepare_order(project, &extra)?;
        let catalog = self
            .work_catalog(false, self.order_source.is_none(), false)
            .map_err(|code| std::io::Error::other(code.text()))?;
        let membership = crate::store::project_orders::WorkMembership::from_catalog(&catalog);
        self.store
            .project_transaction(&self.keyring.space_id, &self.keyring.owner_public(), |tx| {
                tx.move_project_item(project, revision, item, position, |id| {
                    membership.classify(project, id)
                })
            })
    }

    fn visible_project_orders(
        &self,
        catalog: &serde_json::Value,
    ) -> std::result::Result<
        std::collections::BTreeMap<String, crate::store::project_orders::ProjectOrder>,
        Code,
    > {
        let membership = crate::store::project_orders::WorkMembership::from_catalog(catalog);
        let orders = self
            .store
            .project_orders()
            .map_err(|error| map_error(error.into()))?;
        Ok(orders
            .into_iter()
            .map(|(project, order)| {
                let shown = order.visible(&|item| membership.classify(&project, item));
                (project, shown)
            })
            .collect())
    }

    fn work_catalog(
        &self,
        bounded: bool,
        serving: bool,
        section_progress: bool,
    ) -> std::result::Result<serde_json::Value, Code> {
        let CatalogRead {
            mut catalog,
            fingerprints,
            titles,
            revisions,
            progress,
        } = self.page_catalog_fingerprinted(serving)?;
        let fresh: std::collections::BTreeMap<String, crate::summary::Summary> = catalog["pages"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|page| {
                let id = page["pageId"].as_str()?;
                let summary = self.summaries.get(id, fingerprints.get(id)?)?;
                Some((id.to_owned(), summary))
            })
            .collect();
        let found: crate::work_index::Found = fresh
            .iter()
            .map(|(id, summary)| (id.clone(), summary.work.as_deref().cloned()))
            .collect();
        let graph = crate::work_links::Graph(&found);
        let parents = graph.parents();
        let archived = crate::inspection::catalog_archived_ids(&catalog);
        let now = now_ms()?;
        let listed = self.list_statuses(fresh.keys(), &fingerprints, now, serving);
        let statuses: std::collections::BTreeMap<String, String> = listed
            .iter()
            .map(|(id, (state, _))| (id.clone(), state.clone()))
            .collect();
        let sections: std::collections::BTreeMap<_, _> = fresh
            .keys()
            .filter(|_| section_progress)
            .filter_map(|id| {
                let (sections, omitted) = self.summaries.sections(id, fingerprints.get(id)?)?;
                (!sections.is_empty() || omitted).then_some((id.clone(), (sections, omitted)))
            })
            .collect();
        let status = |page: &str| statuses.get(page).cloned();
        for page in catalog["pages"].as_array_mut().into_iter().flatten() {
            let Some(id) = page["pageId"].as_str().map(str::to_owned) else {
                continue;
            };
            if let Some(revision) = revisions.get(&id) {
                page["revision"] = serde_json::json!(revision);
                if let Some(progress) = progress.get(&id) {
                    page["contentRevision"] = serde_json::json!(content_revision(&id, progress)?);
                }
            }
            let Some(summary) = fresh.get(&id) else {
                page["state"] = serde_json::Value::Null;
                page["stateError"] = serde_json::json!("page-unavailable");
                continue;
            };
            page["state"] = serde_json::json!(graph.page_state(&id));
            page["summary"] = summary.json();
            if section_progress
                && let Some(progress) = sections
                    .get(&id)
                    .and_then(|(sections, _)| crate::sections::progress(sections, now))
            {
                page["summary"]["sectionProgress"] = serde_json::json!(progress);
            }
            if let Some(state) = statuses.get(&id) {
                page["summary"]["status"] = serde_json::json!(state);
            }
            if let Some((_, Some(release))) = listed.get(&id) {
                page["summary"]["release"] = serde_json::json!(release);
            }
            if let Some(work) = graph.row(&id, &archived, &status) {
                page["summary"]["work"] = work;
            }
            if let Some((parent, index)) = parents.get(&id) {
                page["summary"]["parent"] = serde_json::json!({"page": parent, "index": index});
            }
        }
        let todos = self.observe_work(&mut catalog, &fresh, &fingerprints, &statuses, now, serving);
        if let Some(open) = &self.summary_source {
            // Every page without a fresh summary is folded in the background, newest first, so the
            // next read has more of them; this read never waits for it.
            let order = crate::summary::recent_first(&catalog, &fingerprints);
            if !self.summaries.stale(&order, 1).is_empty() {
                crate::summary::drain(&self.summaries, open);
            }
        }
        catalog["listToken"] = serde_json::json!(list_token(&fingerprints)?);
        if bounded && !section_progress {
            crate::page_titles::attach_to_catalog(&mut catalog, &titles);
        } else if !bounded {
            for row in catalog["pages"].as_array_mut().into_iter().flatten() {
                if let Some(title) = row["pageId"].as_str().and_then(|id| titles.get(id)) {
                    row["title"] = serde_json::json!(title);
                }
            }
        }
        // Work fields are optional display data. Keep the complete catalog within the existing
        // discovery bound even when every page has the longest allowed notes.
        if bounded {
            catalog["projectPrefixes"] = serde_json::json!(
                self.store
                    .project_prefixes()
                    .map_err(|e| map_error(e.into()))?
            );
            catalog["projectOrders"] = serde_json::json!({});
            catalog["projectOrdersOmitted"] = catalog["projects"].clone();
        }
        // The native Work snapshot reserves room for omission flags. Inserting the
        // aggregate before optional text must not let those flags overflow the reply.
        let reserve = if section_progress {
            24 * todos.len() + 27 * sections.len()
        } else {
            0
        };
        if section_progress {
            crate::page_titles::attach_to_catalog_reserved(&mut catalog, &titles, reserve);
        }
        let mut used = serde_json::to_vec(&catalog)
            .map_err(|_| Code::Unavailable)?
            .len()
            + reserve;
        for page in catalog["pages"].as_array_mut().into_iter().flatten() {
            let Some(fields) = page["pageId"]
                .as_str()
                .and_then(|id| fresh.get(id))
                .and_then(|summary| summary.work.as_ref())
                .map(|work| &work.fields)
                .filter(|fields| fields.as_object().is_some_and(|fields| !fields.is_empty()))
            else {
                continue;
            };
            let cost = serde_json::to_vec(fields)
                .map_err(|_| Code::Unavailable)?
                .len()
                + 16;
            if !bounded || used.saturating_add(cost) <= crate::limits::DISCOVERY_BYTES {
                page["summary"]["fields"] = fields.clone();
                used += cost;
            }
        }
        // To-do work items come last and only while the list stays within the same bound; a page
        // whose items do not fit says so instead of listing some of them.
        for page in catalog["pages"].as_array_mut().into_iter().flatten() {
            let Some(items) = page["pageId"].as_str().and_then(|id| todos.get(id)) else {
                continue;
            };
            let items = serde_json::json!(items);
            let cost = serde_json::to_vec(&items)
                .map_err(|_| Code::Unavailable)?
                .len()
                + 16;
            if !bounded || used.saturating_add(cost) <= crate::limits::DISCOVERY_BYTES {
                page["summary"]["todos"] = items;
                used += cost;
            } else {
                page["summary"]["todosOmitted"] = serde_json::json!(true);
                if !section_progress {
                    used += 24;
                }
            }
        }
        // Sections come after the to-dos within the same bound (#6619): the counted ones, with the
        // status the fold alone decides.
        for page in catalog["pages"].as_array_mut().into_iter().flatten() {
            let Some(id) = page["pageId"].as_str().map(str::to_owned) else {
                continue;
            };
            if !page["summary"].is_object() {
                continue;
            }
            let Some((sections, omitted)) = fingerprints
                .get(&id)
                .and_then(|fingerprint| self.summaries.sections(&id, fingerprint))
            else {
                continue;
            };
            let rows = crate::sections::summary(&sections, |section| section.folded_state(now));
            if rows.as_array().is_none_or(Vec::is_empty) && !omitted {
                continue;
            }
            let cost = serde_json::to_vec(&rows)
                .map_err(|_| Code::Unavailable)?
                .len()
                + 40;
            if used.saturating_add(cost) <= crate::limits::DISCOVERY_BYTES {
                page["summary"]["sections"] = rows;
                if omitted {
                    page["summary"]["sectionsOmitted"] = serde_json::json!(true);
                }
                used += cost;
            } else {
                page["summary"]["sectionsOmitted"] = serde_json::json!(true);
                if !section_progress {
                    used += 27;
                }
            }
        }
        Ok(catalog)
    }
    /// Records and attaches what Work home needs from the list read (#6474): when each page was
    /// first seen done (`summary.doneAtMs`) or blocked (`summary.blockedSinceMs`), and each page's
    /// to-do work items with their number and first-seen-done time. A status this read cannot
    /// decide changes nothing. Recording is best effort: a store failure leaves times out.
    fn observe_work(
        &self,
        catalog: &mut serde_json::Value,
        fresh: &std::collections::BTreeMap<String, crate::summary::Summary>,
        fingerprints: &std::collections::BTreeMap<String, String>,
        statuses: &std::collections::BTreeMap<String, String>,
        now: u64,
        serving: bool,
    ) -> std::collections::BTreeMap<String, Vec<serde_json::Value>> {
        let items: std::collections::BTreeMap<_, _> = fresh
            .keys()
            .filter_map(|id| {
                let todos = self.summaries.todo_items(id, fingerprints.get(id)?)?;
                (!todos.is_empty()).then(|| (id.clone(), todos))
            })
            .collect();
        // An item's first-seen time is the earlier of now and its page's last admitted activity,
        // so an item already done when the list first sees it keeps that activity's time.
        let activity: std::collections::BTreeMap<String, u64> = catalog["pages"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|page| {
                Some((
                    page["pageId"].as_str()?.to_owned(),
                    page["lastUpdateAtMs"].as_u64()?,
                ))
            })
            .collect();
        let at = |id: &str| activity.get(id).map_or(now, |&last| last.min(now));
        let mut observed = Vec::new();
        for (id, summary) in fresh {
            let done = match statuses.get(id).map(String::as_str) {
                Some("done") => Some(true),
                None | Some("unknown" | "unchecked") => None,
                Some(_) => Some(false),
            };
            observed.push((id.clone(), "done", done, at(id)));
            let blocked = summary
                .work
                .as_ref()
                .and_then(|work| work.fields.get("blocked"))
                .and_then(serde_json::Value::as_str)
                .is_some_and(|reason| !reason.is_empty());
            observed.push((id.clone(), "blocked", Some(blocked), at(id)));
        }
        let todo_statuses = self
            .store
            .todo_pull_statuses(fingerprints, now)
            .unwrap_or_default();
        let mut complete = Vec::new();
        for (id, todos) in &items {
            for todo in todos {
                observed.push((
                    format!("{id}:{}", todo.id),
                    "done",
                    todo_statuses
                        .get(&format!("{id}:{}", todo.id))
                        .map_or(Some(todo.checked), |state| {
                            (state != "unknown").then(|| state == "done")
                        }),
                    at(id),
                ));
            }
            if todos.len() < crate::limits::WORK_TODOS {
                complete.push((
                    id.clone(),
                    todos.iter().map(|todo| todo.id.clone()).collect(),
                ));
            }
        }
        // A fresh page without to-dos lists all of none.
        for id in fresh.keys().filter(|id| !items.contains_key(*id)) {
            if self
                .summaries
                .todo_items(id, &fingerprints[id.as_str()])
                .is_some()
            {
                complete.push((id.clone(), std::collections::HashSet::new()));
            }
        }
        if !serving {
            // Observe unknowns to retrieve retained times without inserting or clearing any.
            for (_, _, present, _) in &mut observed {
                *present = None;
            }
            complete.clear();
        }
        let times = self
            .store
            .observe_work(&observed, &complete)
            .unwrap_or_default();
        let numbers = self.store.work_numbers().unwrap_or_default();
        for page in catalog["pages"].as_array_mut().into_iter().flatten() {
            let Some(id) = page["pageId"].as_str().map(str::to_owned) else {
                continue;
            };
            if !page["summary"].is_object() {
                continue;
            }
            if let Some(at) = times.get(&(id.clone(), "done")) {
                page["summary"]["doneAtMs"] = serde_json::json!(at);
            }
            if let Some(at) = times.get(&(id.clone(), "blocked")) {
                page["summary"]["blockedSinceMs"] = serde_json::json!(at);
            }
        }
        items
            .into_iter()
            .map(|(id, todos)| {
                let rows = todos
                    .into_iter()
                    .map(|todo| {
                        let item = format!("{id}:{}", todo.id);
                        let mut row = serde_json::json!({
                            "id": todo.id, "text": todo.text, "checked": todo.checked,
                        });
                        if let Some(status) = todo_statuses.get(&item) {
                            row["pullStatus"] = serde_json::json!(status);
                        }
                        if let Some(number) = numbers.get(&item) {
                            row["number"] = serde_json::json!(number);
                        }
                        if let Some(due) = todo.due {
                            row["due"] = due.into();
                        }
                        if let Some(assignee) = todo.assignee {
                            row["assignee"] = serde_json::json!(assignee);
                        }
                        if let Some(at) = times.get(&(item, "done")) {
                            row["doneAtMs"] = serde_json::json!(at);
                        }
                        if let Some(ask) = todo.ask {
                            row["ask"] = serde_json::json!(ask);
                        }
                        row
                    })
                    .collect();
                (id, rows)
            })
            .collect()
    }
    /// Each fresh page's list status (#6474): the status an owner page view retained for this
    /// exact fingerprint (the one `show` reports), else what the fold alone decides
    /// (`work_index::derived_state`). No GitHub or activity read happens here.
    fn list_statuses<'a>(
        &self,
        pages: impl Iterator<Item = &'a String>,
        fingerprints: &std::collections::BTreeMap<String, String>,
        now: u64,
        serving: bool,
    ) -> std::collections::BTreeMap<String, (String, Option<String>)> {
        pages
            .filter_map(|id| {
                let retained = self
                    .store
                    .cached_work_status_with_fingerprints(
                        &self.keyring,
                        id,
                        now,
                        Some(fingerprints),
                    )
                    .ok()
                    .flatten();
                // The release a retained fact proved for one of the page's PRs (#6474 Work home).
                let release = retained.as_ref().and_then(|status| {
                    status["pulls"].as_array()?.iter().rev().find_map(|pull| {
                        let fact = &pull["fact"];
                        (fact["released"] == true)
                            .then(|| fact["tag"].as_str().map(str::to_owned))
                            .flatten()
                    })
                });
                let retained = retained
                    .filter(|_| serving)
                    .and_then(|status| status["state"].as_str().map(str::to_owned));
                let state = retained.or_else(|| {
                    self.summaries
                        .derived_state(id, fingerprints.get(id)?, now, &|owner| {
                            Some(
                                self.work_facts
                                    .as_ref()?
                                    .retained_activity(owner)?
                                    .activity(),
                            )
                        })
                        .map(str::to_owned)
                })?;
                Some((id.clone(), (state, release)))
            })
            .collect()
    }
    /// The page list's opaque change token (contract: Live page list): it moves when any page's
    /// fingerprint does, which is when its revision token does, and never otherwise.
    /// While the store has no write since the last answer, the token is that answer's.
    pub fn page_list_token(&self, context: Option<&str>) -> std::result::Result<String, Code> {
        Context::parse(context)?;
        let generation = self
            .store
            .write_generation()
            .map_err(|error| map_error(error.into()))?;
        if let Some((at, token)) = self.list_token.borrow().as_ref()
            && *at == generation
        {
            return Ok(token.clone());
        }
        let token = self
            .store
            .owner_read(&self.keyring.space_id, &self.keyring.owner_public(), |tx| {
                tx.page_fingerprints()
            })
            .map_err(map_error)
            .and_then(|fingerprints| list_token(&fingerprints))?;
        *self.list_token.borrow_mut() = Some((generation, token.clone()));
        Ok(token)
    }
    /// Owner-local labels for only the named blocks; never allocates on a read.
    pub fn work_numbers(
        &self,
        context: Option<&str>,
        body: &[u8],
    ) -> std::result::Result<Vec<u8>, Code> {
        Context::parse(context)?;
        let request: WorkNumbersRequest =
            serde_json::from_slice(body).map_err(|_| Code::Invalid)?;
        values::generated_id(&request.page_id).map_err(|_| Code::Invalid)?;
        if request.blocks.len() > crate::limits::BLOCKS {
            return Err(Code::Invalid);
        }
        let mut seen = std::collections::BTreeSet::new();
        for block in &request.blocks {
            values::generated_id(block).map_err(|_| Code::Invalid)?;
            if !seen.insert(block) {
                return Err(Code::Invalid);
            }
        }
        let numbers = self
            .store
            .owner_read(&self.keyring.space_id, &self.keyring.owner_public(), |tx| {
                if tx.page_epoch(&request.page_id)?.is_none() {
                    return Err(crate::store::owner::OwnerFault::Invalid.into());
                }
                tx.todo_numbers(&request.page_id, &request.blocks)
            })
            .map_err(map_error)?;
        serde_json::to_vec(&serde_json::json!({"pageId":request.page_id,"numbers":numbers}))
            .map_err(|_| Code::Unavailable)
    }

    /// The owner page's admitted PR links, never a URL supplied by the browser.
    /// The owners a Work home activity read may ask about (#6474): the requested ids, at most
    /// [`crate::limits::WORK_ACTIVITY_OWNERS`], that some page with a fresh fold names as its
    /// owner, so the read never reports an identity no page shows.
    pub(crate) fn work_activity_owners(
        &mut self,
        context: Option<&str>,
        body: &[u8],
    ) -> std::result::Result<Vec<String>, Code> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            owners: Vec<String>,
        }
        let request: Request = serde_json::from_slice(body).map_err(|_| Code::Invalid)?;
        if request.owners.len() > crate::limits::WORK_ACTIVITY_OWNERS
            || request
                .owners
                .iter()
                .any(|owner| owner.is_empty() || owner.len() > 128)
        {
            return Err(Code::Invalid);
        }
        self.active_device(context, now_ms()?)?;
        let named = self.summaries.owners();
        let mut owners: Vec<String> = request
            .owners
            .into_iter()
            .filter(|owner| named.contains(owner))
            .collect();
        owners.sort();
        owners.dedup();
        Ok(owners)
    }
    pub(crate) fn work_facts_input(
        &mut self,
        context: Option<&str>,
        body: &[u8],
    ) -> std::result::Result<WorkFactsInput, Code> {
        let request: WorkFactsRequest = serde_json::from_slice(body).map_err(|_| Code::Invalid)?;
        values::generated_id(&request.page_id).map_err(|_| Code::Invalid)?;
        let device = Context::parse(context)?.device_id;
        self.active_device(context, now_ms()?)?;
        let fingerprint = self
            .store
            .owner_read(&self.keyring.space_id, &self.keyring.owner_public(), |tx| {
                tx.page_fingerprint(&request.page_id)
            })
            .map_err(map_error)?
            .ok_or(Code::Denied)?;
        let projection = match self.summaries.details(&request.page_id, &fingerprint) {
            crate::summary::CachedDetails::Ready(projection) => Some(*projection),
            _ => None,
        };
        let prefix = self
            .store
            .release_tag_prefix_for_page(&request.page_id)
            .map_err(|_| Code::Unavailable)?;
        let repository = self
            .store
            .repository_for_page(&request.page_id)
            .map_err(|_| Code::Unavailable)?;
        let mut numbers = Vec::new();
        let mut numbered_blocks = std::collections::BTreeMap::new();
        let mut number = self
            .store
            .work_number(&request.page_id)
            .map_err(|_| Code::Unavailable)?;
        numbers.extend(number.iter().cloned());
        if let Some(id) = &request.block_id {
            values::generated_id(id).map_err(|_| Code::Invalid)?;
            if !projection
                .as_ref()
                .is_some_and(|p| p.todo_items.iter().any(|t| &t.id == id))
            {
                return Err(Code::Denied);
            }
            number = None;
        }
        if repository.is_some() {
            for todo in projection.iter().flat_map(|p| &p.todo_items) {
                if let Some(issued) = self
                    .store
                    .work_number(&format!("{}:{}", request.page_id, todo.id))
                    .map_err(|_| Code::Unavailable)?
                {
                    if request.block_id.as_ref() == Some(&todo.id) {
                        number = Some(issued.clone());
                    }
                    numbered_blocks.insert(issued.clone(), todo.id.clone());
                    numbers.push(issued);
                }
            }
        }
        Ok(WorkFactsInput {
            exclusion: request.exclusion,
            numbers,
            numbered_blocks,
            block: request.block_id,
            repository,
            number,
            device,
            projection,
            never_written: self
                .store
                .page_never_written(&request.page_id)
                .map_err(|_| Code::Unavailable)?,
            last_activity_at_ms: self
                .store
                .last_activity_ms(&request.page_id)
                .map_err(|_| Code::Unavailable)?,
            page: request.page_id,
            prefix,
            fingerprint,
        })
    }

    /// Complete cached chapter metadata. The owner read checks authority and the current
    /// fingerprint without subscribing, touching activity or decoding on this request path.
    pub fn page_summary_details(
        &self,
        context: Option<&str>,
        page: &str,
        include_answer_bindings: bool,
    ) -> std::result::Result<Vec<u8>, Code> {
        Context::parse(context)?;
        values::generated_id(page).map_err(|_| Code::Invalid)?;
        let fingerprint = self
            .store
            .owner_read(&self.keyring.space_id, &self.keyring.owner_public(), |tx| {
                tx.page_fingerprint(page)
            })
            .map_err(map_error)?
            .ok_or(Code::Denied)?;
        let value = match self.summaries.details(page, &fingerprint) {
            crate::summary::CachedDetails::Ready(projection) => {
                let digest: String = crypto::digest(fingerprint.as_bytes())
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect();
                let (catalog, fingerprints) = self.owner_catalog_fingerprinted()?;
                let found: crate::work_index::Found = catalog["pages"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|row| {
                        let id = row["pageId"].as_str()?;
                        let summary = self.summaries.get(id, fingerprints.get(id)?)?;
                        Some((id.to_owned(), summary.work.as_deref().cloned()))
                    })
                    .collect();
                let graph = crate::work_links::Graph(&found);
                let archived = crate::inspection::catalog_archived_ids(&catalog);
                let current = fingerprints.get(page) == Some(&fingerprint);
                let state = current.then(|| graph.page_state(page)).flatten();
                // The work panel counts sub-pages as the list row does (#6474).
                let statuses = self.list_statuses(found.keys(), &fingerprints, now_ms()?, true);
                let status = |child: &str| statuses.get(child).map(|(state, _)| state.clone());
                let progress = current
                    .then(|| graph.progress_by(page, &archived, &status))
                    .flatten();
                let mut ready = serde_json::json!({"pageId":page,"state":"ready","fingerprint":digest,
                    "pageState":state,"progress":progress,
                    "summary":projection.summary.json(),"readings":projection.readings,
                    "needs":projection.needs});
                if let Some(latest) = &projection.latest {
                    ready["latest"] = serde_json::json!(latest);
                }
                if include_answer_bindings && !projection.answer_bindings.is_empty() {
                    ready["answerBindings"] = serde_json::json!(projection.answer_bindings);
                }
                ready
            }
            crate::summary::CachedDetails::Unavailable => {
                serde_json::json!({"pageId":page,"state":"unavailable"})
            }
            crate::summary::CachedDetails::Pending if self.summary_source.is_some() => {
                // Do not call stale() on a single-page map: it also prunes the full cache.
                crate::summary::refresh(
                    &self.summaries,
                    self.summary_source.as_ref().expect("source checked"),
                    vec![(page.to_owned(), fingerprint)],
                );
                serde_json::json!({"pageId":page,"state":"pending"})
            }
            crate::summary::CachedDetails::Pending => {
                serde_json::json!({"pageId":page,"state":"unavailable"})
            }
        };
        let bytes = serde_json::to_vec(&value).map_err(|_| Code::Unavailable)?;
        if bytes.len() > crate::limits::SUMMARY_DETAILS_BYTES {
            return serde_json::to_vec(&serde_json::json!({"pageId":page,"state":"unavailable"}))
                .map_err(|_| Code::Unavailable);
        }
        Ok(bytes)
    }
    /// The browser's catalog read: the page list, each page's fingerprint and the local titles still
    /// valid for their page, all in one store transaction.
    fn page_catalog_fingerprinted(
        &self,
        include_revisions: bool,
    ) -> std::result::Result<CatalogRead, Code> {
        self.store
            .owner_read(&self.keyring.space_id, &self.keyring.owner_public(), |tx| {
                let catalog = tx.page_list()?;
                let mut revisions = std::collections::BTreeMap::new();
                if include_revisions {
                    for page in catalog["pages"].as_array().into_iter().flatten() {
                        if let Some(id) = page["pageId"].as_str()
                            && let Some(revision) =
                                crate::page::listed_token(tx, &self.keyring, id)?
                        {
                            revisions.insert(id.to_owned(), revision);
                        }
                    }
                }
                Ok(CatalogRead {
                    catalog,
                    fingerprints: tx.page_fingerprints()?,
                    titles: tx.page_titles()?,
                    revisions,
                    progress: tx.page_progress()?,
                })
            })
            .map_err(map_error)
    }
    fn owner_catalog_fingerprinted(
        &self,
    ) -> std::result::Result<
        (
            serde_json::Value,
            std::collections::BTreeMap<String, String>,
        ),
        Code,
    > {
        self.store
            .owner_read(&self.keyring.space_id, &self.keyring.owner_public(), |tx| {
                Ok((tx.page_list()?, tx.page_fingerprints()?))
            })
            .map_err(map_error)
    }
    /// Static display-only navigation remains available while catalog work holds the service lock.
    /// With `modules` (the caller admits extra modules, #5811), Design rides along as Colab's
    /// one extra rail module (#5819, #5866), inside Colab's own mount, loaded by the same module script.
    /// With `home` (the caller admits a module home, #6474), Colab claims Home with Work home.
    pub(crate) fn navigation_description(features: DescribeFeatures) -> serde_json::Value {
        let DescribeFeatures { modules, home } = features;
        let mut answer = serde_json::json!({
            "version":1,
            "rail":{"label":"Colab","icon":"file-text","path":"/","order":100},
            "menu":[{"id":"pages","label":"Pages","path":"/"}],
            "settings":[],
            "entry":"/assets/colab-module.js"
        });
        if home {
            answer["homePage"] = serde_json::json!("/work");
        }
        if modules {
            answer["modules"] = serde_json::json!([{
                "id":"design",
                "rootAppFamily":"/design",
                "rail":{"label":"Design","icon":"palette","path":"/design/","order":101},
                "menu":[],
                "settings":[],
                "entry":"/assets/colab-module.js"
            }]);
        }
        answer
    }
    /// Display-only owner-socket callback. Unlike pages(), this never schedules a refresh.
    pub(crate) fn describe(
        &self,
        features: DescribeFeatures,
    ) -> std::result::Result<Vec<u8>, Code> {
        let (catalog, fingerprints) = self.owner_catalog_fingerprinted()?;
        let pages: Vec<_> = catalog["pages"]
            .as_array()
            .ok_or(Code::Unavailable)?
            .iter()
            .filter(|page| page["archived"] != true)
            .collect();
        if pages.len() > crate::limits::DESCRIBE_COUNT {
            return Err(Code::Capacity);
        }
        // Match the page list's waitingCount: one waiting page, regardless of its item count.
        // Its count cannot exceed the already-bounded active page count.
        let needs_you = pages.iter().try_fold(0usize, |count, page| {
            let id = page["pageId"].as_str()?;
            let fingerprint = fingerprints.get(id)?;
            let summary = self.summaries.get(id, fingerprint)?;
            Some(count + usize::from(summary.waiting))
        });
        let mut answer = Self::navigation_description(features);
        answer["menu"][0]["count"] = serde_json::json!({"value":pages.len(),"kind":"plain"});
        if let Some(needs_you) = needs_you {
            answer["needsYou"] = serde_json::json!(needs_you);
        }
        let home = self.home_cards(&pages);
        if !home.is_empty() {
            answer["home"] = serde_json::json!(home);
        }
        serde_json::to_vec(&answer).map_err(|_| Code::Unavailable)
    }
    /// Home's "Recent pages": the most recently active open pages that have a title in the local
    /// projection (#4218), newest first. Grant rule: describe answers only the owner's own socket,
    /// and Remote composes it only for a live owner-device session, so every viewer can already read
    /// these pages; a page without a current title gets no card rather than a placeholder. This read
    /// only selects; the owner's folds keep the projection.
    fn home_cards(&self, pages: &[&serde_json::Value]) -> Vec<serde_json::Value> {
        let Ok(stored) =
            self.store
                .owner_read(&self.keyring.space_id, &self.keyring.owner_public(), |tx| {
                    tx.page_titles()
                })
        else {
            return Vec::new();
        };
        let recency = |page: &serde_json::Value| {
            page["lastActivityAtMs"]
                .as_u64()
                .max(page["lastUpdateAtMs"].as_u64())
        };
        let mut recent: Vec<_> = pages
            .iter()
            .filter_map(|page| {
                let id = page["pageId"].as_str()?;
                Some((recency(page), id, stored.get(id)?))
            })
            .collect();
        recent.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(b.1)));
        recent
            .into_iter()
            .take(HOME_CARDS)
            .map(|(_, id, title)| {
                serde_json::json!({
                    "id": id.replace('-', ""),
                    "title": card_title(title),
                    "path": format!("/pages/{id}"),
                })
            })
            .collect()
    }
    /// The caller serializes management with sync before taking this mutex.
    pub fn apply_owner(
        &mut self,
        request: crate::transitions::OwnerRequest<'_>,
        now: u64,
    ) -> std::result::Result<crate::transitions::Applied, crate::transitions::TransitionError> {
        self.engine
            .apply(&mut self.store, &self.keyring, request, now)
    }
    /// Display-only project writes: the caller serializes management with sync before this mutex.
    pub fn set_projects(
        &mut self,
        changes: &[(String, Vec<String>)],
    ) -> std::result::Result<tmt_colab_model::statement::Head, crate::transitions::TransitionError>
    {
        self.engine
            .set_projects(&mut self.store, &self.keyring, changes)
    }
    pub fn set_pinned(
        &mut self,
        page: &str,
        pinned: bool,
    ) -> std::result::Result<tmt_colab_model::statement::Head, crate::transitions::TransitionError>
    {
        self.engine
            .set_pinned(&mut self.store, &self.keyring, page, pinned)
    }
    pub fn manage_project(
        &mut self,
        change: &crate::projects::Change,
    ) -> std::result::Result<tmt_colab_model::statement::Head, crate::transitions::TransitionError>
    {
        self.engine
            .manage_project(&mut self.store, &self.keyring, change)
    }
    /// The public key that must have signed a root-local batch; never request-selected.
    pub(crate) fn author_key(&self) -> crate::Result<[u8; 32]> {
        Ok(self.keyring.local_writer()?.1)
    }
    pub(crate) fn recover_edit(
        &mut self,
        body: &[u8],
        now: u64,
    ) -> crate::Result<crate::page::compact::RecoveredEdit> {
        let intent = crate::page::ipc::RecoveryWrite::parse(body, &self.author_key()?)?;
        let decoder = self.engine.decoder(&intent.page)?;
        crate::page::compact::recover_edit(&mut self.store, &self.keyring, &intent, decoder, now)
    }
    /// Root-local sealed batch commit; caller holds the sync mutex before this service.
    pub(crate) fn publish(
        &mut self,
        job: &crate::publication::SignedJob,
        packet: &[u8],
        chain: &[u8],
        now: u64,
        combine_until: std::time::Instant,
    ) -> crate::Result<crate::sync::Commit> {
        let committed = crate::page::commit_publication(
            &mut self.store,
            &self.keyring,
            job,
            packet,
            chain,
            now,
        )?;
        let mut combined = None;
        if committed.accepted == crate::store::Accepted::New
            && matches!(
                committed.record.outcome,
                crate::publication::Outcome::Committed { .. }
            )
        {
            // Combining this device's own tail is best effort: the write is already durable, and
            // the next write tries again.
            let page = &job.manifest.page_id;
            combined = self
                .engine
                .decoder(page)
                .and_then(|decoder| {
                    crate::page::compact::compact(
                        &mut self.store,
                        &self.keyring,
                        page,
                        decoder,
                        crate::page::compact::Trigger {
                            until: Some(combine_until),
                            ..Default::default()
                        },
                    )
                })
                .ok()
                .flatten()
                .zip(self.keyring.local_writer().ok())
                .map(|(done, (stream, ..))| crate::sync::Combined {
                    stream,
                    through: done.through,
                });
        }
        if committed.accepted == crate::store::Accepted::New
            && matches!(
                job.manifest.kind,
                crate::publication::PublicationKind::Content
            )
            && matches!(
                committed.record.outcome,
                crate::publication::Outcome::Committed { .. }
            )
            && let Some(open) = &self.summary_source
        {
            crate::summary::after_write(&self.summaries, open);
        }
        // The sync mutex is held, so no other writer can move the page between the combine and
        // this read: the revision is the one this write's reply reports.
        let revision = matches!(
            committed.record.outcome,
            crate::publication::Outcome::Committed { .. }
        )
        .then(|| crate::page::revision(&self.store, &self.keyring, &job.manifest.page_id).ok())
        .flatten();
        Ok(crate::sync::Commit {
            committed,
            revision,
            combined,
        })
    }
    /// A requested combine of this device's own stream, reported to whoever asked. The caller
    /// holds the sync mutex first, so no write moves the page between its reads and its combine.
    pub(crate) fn compact(
        &mut self,
        page: &str,
        until: std::time::Instant,
    ) -> crate::Result<crate::page::compact::Report> {
        let decoder = self.engine.decoder(page)?;
        crate::page::compact::request(&mut self.store, &self.keyring, page, decoder, Some(until))
    }
    /// Read one owner's storage report under the sync and registration locks.
    pub(crate) fn read_storage(
        &mut self,
        page: &str,
        context: Option<&str>,
        browser: bool,
    ) -> crate::Result<crate::storage::PageStorage> {
        if browser {
            let now = now_ms().map_err(|_| crate::page::Fault::Unavailable)?;
            self.management_device(context, now)
                .map_err(|_| crate::page::Fault::Denied)?;
        }
        let catalog = crate::inspection::catalog(&self.store, &self.keyring)?;
        let item = catalog["pages"]
            .as_array()
            .ok_or(crate::page::Fault::Invalid)?
            .iter()
            .find(|item| item["pageId"] == page)
            .ok_or(crate::page::Fault::Missing)?;
        let decoder = self.engine.decoder(page)?;
        crate::storage::read_page(&self.store, &self.keyring, item, decoder)
    }

    /// Reclaim under the sync mutex; owner admission and policy are checked before the effect.
    pub(crate) fn reclaim_storage(
        &mut self,
        page: &str,
        context: Option<&str>,
        browser: bool,
        dry_run: bool,
        until: std::time::Instant,
    ) -> crate::Result<(
        crate::storage::Reclaim,
        Option<crate::page::compact::Report>,
    )> {
        if browser {
            let now = now_ms().map_err(|_| crate::page::Fault::Unavailable)?;
            self.management_device(context, now)
                .map_err(|_| crate::page::Fault::Denied)?;
        }
        let decoder = self.engine.decoder(page)?;
        crate::storage::reclaim_with_report(
            &mut self.store,
            &self.keyring,
            page,
            decoder,
            dry_run,
            Some(until),
        )
    }

    /// How full the page is. The caller holds the sync mutex first.
    pub(crate) fn usage(&mut self, page: &str) -> crate::Result<crate::page::PageUsage> {
        let decoder = self.engine.decoder(page)?;
        crate::page::usage(&self.store, &self.keyring, page, decoder)
    }
    /// What the root-local stream recorded for an operation a browser Save chose. Read-only. A
    /// convert operation also names the page it made, if that page exists, so a lost reply says
    /// both whether the page was made and whether the link landed.
    pub(crate) fn save_status(
        &self,
        page: &str,
        operation_id: &str,
    ) -> crate::Result<crate::page::save::SaveResult> {
        let recorded = crate::page::save::SaveResult::recorded(
            operation_id,
            crate::page::publication_status_by_operation(
                &self.store,
                &self.keyring,
                page,
                operation_id,
            )?,
        )?;
        let child = crate::subpage_create::child_page_id(&self.keyring.space_id, operation_id);
        Ok(recorded.with_child(self.page_epoch(&child).map(|_| child)))
    }
    /// Make the page a browser's create operation names, as the owner's own `page.create`: a
    /// column page with this title and first text, no publisher agent and nothing the browser
    /// chose. The caller holds the sync lock and has authorized the owner device.
    pub(crate) fn create_child(
        &mut self,
        page: &str,
        operation_id: &str,
        title: &str,
        source: &str,
        blocks: bool,
        now: u64,
    ) -> crate::Result<()> {
        let space = self.keyring.space_id.clone();
        let revision = self
            .store
            .owner_head(&space, &self.keyring.owner_public())?
            .map_or(0, |head| head.revision)
            .to_string();
        let mut payload = serde_json::json!({"pageId": page, "title": title, "source": source});
        if blocks {
            payload["pageType"] = serde_json::json!("blocks");
        } else {
            payload["layout"] = serde_json::json!(crate::decoder::PageLayout {
                kind: crate::decoder::LayoutKind::Column,
                reason: None,
            });
        }
        let body = serde_json::to_vec(&serde_json::json!({
            "space": space, "page": page, "expectedRevision": revision,
            "operationId": crate::subpage_create::create_operation_id(&space, operation_id),
            "operation": "page.create",
            "payload": tmt_colab_model::values::encode_binary(&serde_json::to_vec(&payload)?),
        }))?;
        crate::management::local(self, &space, &body, now)
            .map(|_| ())
            .map_err(|code| {
                crate::work_admission::refused(
                    match code {
                        crate::management::Code::Capacity => "COLAB_CAPACITY",
                        _ => "COLAB_UNAVAILABLE",
                    },
                    "The page for this task could not be made.",
                )
            })
    }
    /// Where a browser Save gets a snapshot of its own to prepare from, outside every lock.
    pub(crate) fn save_source(&self) -> Option<crate::page::save::SourceOpener> {
        self.save_source.clone()
    }
    /// The serve supplies how to open a fresh read-only store, keyring and decoder, so that a
    /// large preparation never holds the writer or the sync mutex.
    /// The source the page summary refresh reads through; the serve supplies it, so a registration
    /// built without one (a test, an offline tool) lists pages without summaries.
    pub fn with_summary_source(mut self, open: crate::page::save::SourceOpener) -> Self {
        self.summary_source = Some(open);
        self
    }
    /// Folds every page that has no fresh summary or title yet, once, on the background worker: the
    /// first list read does the same, so the serve starts it, and a store that gained its title
    /// projection by an upgrade fills without anyone opening the list. Never blocks; without a
    /// summary source (a test, an offline tool) it does nothing.
    pub fn start_summaries(&self) {
        if let Some(open) = &self.summary_source {
            crate::summary::drain(&self.summaries, open);
        }
    }
    pub fn with_work_facts(mut self, facts: std::sync::Arc<crate::work_facts::Facts>) -> Self {
        self.work_facts = Some(facts);
        self
    }
    pub fn with_save_source(mut self, open: crate::page::save::SourceOpener) -> Self {
        self.save_source = Some(open);
        self
    }
    pub(crate) fn management_device(
        &mut self,
        context: Option<&str>,
        now: u64,
    ) -> std::result::Result<(String, [u8; 32]), Code> {
        let device = Context::parse(context)?.device_id;
        let signing = self.active_device(context, now)?;
        Ok((device, signing))
    }

    /// The caller supplies server time, never a request-selected clock.
    pub fn register(
        &mut self,
        context: Option<&str>,
        body: &[u8],
        now: u64,
    ) -> std::result::Result<Vec<u8>, Code> {
        values::time(now)?;
        if body.len() > crate::limits::HTTP_BODY_BYTES {
            return Err(Code::Invalid);
        }
        let context = Context::parse(context)?;
        let request: Request = serde_json::from_slice(body).map_err(|_| Code::Invalid)?;
        values::generated_id(&request.device_id)?;
        if request.device_id != context.device_id {
            return Err(Code::Denied);
        }
        let remote_key = context.key()?;
        let signing = request.sign.verify("sign", &remote_key, now)?;
        let encryption = request.enc.verify("enc", &remote_key, now)?;
        self.genesis().map_err(map_error)?;
        let keyring = &self.keyring;
        let apply = |tx: &mut OwnerTransaction<'_>| -> Result<Vec<u8>> {
            let (initial, member, current_revision) = issuer(tx, keyring)?;
            let old_device = tx.device(&context.device_id)?;
            if old_device.as_ref().is_some_and(|d| d.revoked) {
                return Err(Code::Denied.into());
            }
            if let Some(row) = tx.registration(&context.device_id)? {
                if row.revoked || context.grant_revision < row.grant_revision {
                    return Err(Code::Denied.into());
                }
                let mut saved: DeviceRegistration =
                    serde_json::from_slice(&row.binding.ok_or(Code::Unavailable)?)?;
                if saved.context.public_key != context.public_key
                    || saved.signing != signing
                    || saved.encryption != encryption
                {
                    return Err(Code::Conflict.into());
                }
                let device = old_device.as_ref().ok_or(Code::Unavailable)?;
                let chain = certificate::Chain::from_json(&device.chain)?;
                let cert = chain.certificate()?;
                verify_device(
                    &chain,
                    &cert,
                    &initial,
                    &member,
                    &saved,
                    current_revision,
                    &keyring.space_id,
                )?;
                if now < cert.issued_at {
                    return Err(Code::Expired.into());
                }
                if cert.membership_revision == "1"
                    && cert.expires_at.saturating_sub(now) >= RENEWAL_MS
                {
                    saved.context = context;
                    tx.put_registration(
                        &saved.context.device_id,
                        &serde_json::to_vec(&saved)?,
                        saved.context.grant_revision,
                    )?;
                    forward_owner_wraps(tx, keyring, &saved.context.device_id, &encryption)?;
                    return Ok(saved.outcome);
                }
            } else if old_device.is_some() {
                return Err(Code::Conflict.into());
            }
            let cert = certificate::Certificate {
                space: &keyring.space_id,
                issuer_kind: "member",
                issuer_id: &member.id,
                device_id: &context.device_id,
                signing_key: &signing,
                encryption_key: &encryption,
                // The chain resolves the management member's revision-1 member.add,
                // while current_revision still fences live admission above.
                membership_revision: "1",
                issued_at: now,
                expires_at: now.checked_add(CERTIFICATE_MS).ok_or(Code::Invalid)?,
            };
            let chain = serde_json::json!({
                "version":1,
                "issuerStatement":values::encode_binary(&initial.hash()?),
                "deviceCertificate":values::encode_binary(&certificate::input(&cert)?),
                "issuerSignature":values::encode_binary(&keyring.sign_device_certificate(&cert)?)
            });
            let chain_bytes = serde_json::to_vec(&chain)?;
            certificate::Chain::from_json(&chain_bytes)?.verify(
                &initial.hash()?,
                &cert,
                &member.signing_key,
            )?;
            let statement = serde_json::from_slice::<serde_json::Value>(&initial.to_json()?)?;
            let outcome = serde_json::to_vec(
                &serde_json::json!({"chain":chain,"issuerStatement":statement}),
            )?;
            tx.put_device(&Device {
                chain: chain_bytes,
                revoked: false,
            })?;
            let binding = DeviceRegistration {
                context,
                signing,
                encryption,
                outcome: outcome.clone(),
            };
            tx.put_registration(
                &binding.context.device_id,
                &serde_json::to_vec(&binding)?,
                binding.context.grant_revision,
            )?;
            forward_owner_wraps(tx, keyring, &binding.context.device_id, &encryption)?;
            Ok(outcome)
        };
        self.store
            .device_transaction(&keyring.space_id, &keyring.owner_public(), apply)
            .map_err(map_error)
    }
    fn genesis(&mut self) -> Result<()> {
        let key = &self.keyring;
        if self
            .store
            .owner_head(&key.space_id, &key.owner_public())?
            .is_some()
        {
            return Ok(());
        }
        let (_, payload) = crate::transitions::owner_genesis(key)?;
        self.store.owner_transaction(
            &key.space_id,
            &key.owner_public(),
            Mutation {
                operation_id: GENESIS,
                digest: crypto::digest(&payload),
                expected_revision: 0,
            },
            |tx| {
                Ok(crate::transitions::initialize_owner(tx, key)?
                    .ok_or(Code::Unavailable)?
                    .to_json()?)
            },
        )?;
        Ok(())
    }
    /// Trusted remote consumer: known devices commit cuts/rotation and a tombstone;
    /// unknown IDs only tombstone. Equal/older or already-revoked events return false.
    pub fn revoke(&mut self, device_id: &str, grant_revision: u64) -> Result<bool> {
        self.revoke_event(device_id, grant_revision)
            .map(|effect| effect != Revocation::Unchanged)
    }
    /// Preserve the distinction between a registration tombstone and an owner transition:
    /// only the latter can advance page epochs and leave attachments waiting for rekey.
    pub(crate) fn revoke_event(
        &mut self,
        device_id: &str,
        grant_revision: u64,
    ) -> Result<Revocation> {
        values::generated_id(device_id)?;
        if grant_revision == 0 {
            return Err(crate::store::owner::OwnerFault::Invalid.into());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_millis()
            .try_into()?;
        for _ in 0..3 {
            let (known, noop) = self.store.owner_read(
                &self.keyring.space_id,
                &self.keyring.owner_public(),
                |tx| {
                    let device = tx.device(device_id)?;
                    let row = tx.registration(device_id)?;
                    Ok((
                        device.is_some(),
                        device.is_some_and(|d| d.revoked)
                            || row.is_some_and(|r| r.revoked || r.grant_revision >= grant_revision),
                    ))
                },
            )?;
            if noop {
                return Ok(Revocation::Unchanged);
            }
            if known {
                return self
                    .engine
                    .remote_revoke(
                        &mut self.store,
                        &self.keyring,
                        device_id,
                        grant_revision,
                        now,
                    )
                    .map(|changed| {
                        if changed {
                            Revocation::MembershipChanged
                        } else {
                            Revocation::Unchanged
                        }
                    });
            }
            match self.store.revoke_remote_device(
                &self.keyring.space_id,
                &self.keyring.owner_public(),
                device_id,
                grant_revision,
            ) {
                Err(e)
                    if e.downcast_ref::<crate::store::owner::OwnerFault>()
                        == Some(&crate::store::owner::OwnerFault::StaleHead) =>
                {
                    continue;
                }
                other => {
                    return other.map(|changed| {
                        if changed {
                            Revocation::Tombstoned
                        } else {
                            Revocation::Unchanged
                        }
                    });
                }
            }
        }
        Err(crate::store::owner::OwnerFault::StaleHead.into())
    }
    /// Admission for socket/sync composition, checked against durable
    /// revocation every time. A forwarded cookie/session alone is insufficient.
    pub fn active_device(
        &mut self,
        context: Option<&str>,
        now: u64,
    ) -> std::result::Result<[u8; 32], Code> {
        values::time(now)?;
        let context = Context::parse(context)?;
        let key = &self.keyring;
        if self
            .store
            .owner_head(&key.space_id, &key.owner_public())
            .map_err(map_error)?
            .is_none()
        {
            return Err(Code::Denied);
        }
        let bytes = self
            .store
            .device_transaction(&key.space_id, &key.owner_public(), |tx| {
                let row = tx.registration(&context.device_id)?.ok_or(Code::Denied)?;
                if row.revoked || context.grant_revision < row.grant_revision {
                    return Err(Code::Denied.into());
                }
                let mut binding: DeviceRegistration =
                    serde_json::from_slice(&row.binding.ok_or(Code::Denied)?)?;
                if binding.context.public_key != context.public_key {
                    return Err(Code::Denied.into());
                }
                let device = tx.device(&context.device_id)?.ok_or(Code::Denied)?;
                if device.revoked {
                    return Err(Code::Denied.into());
                }
                let chain = certificate::Chain::from_json(&device.chain)?;
                let cert = chain.certificate()?;
                let (initial, member, revision) = issuer(tx, key)?;
                verify_device(
                    &chain,
                    &cert,
                    &initial,
                    &member,
                    &binding,
                    revision,
                    &key.space_id,
                )?;
                if now < cert.issued_at || now >= cert.expires_at {
                    return Err(Code::Expired.into());
                }
                if context.grant_revision > row.grant_revision {
                    binding.context = context;
                    tx.put_registration(
                        &binding.context.device_id,
                        &serde_json::to_vec(&binding)?,
                        binding.context.grant_revision,
                    )?;
                }
                Ok(binding.signing.to_vec())
            })
            .map_err(map_error)?;
        bytes.try_into().map_err(|_| Code::Unavailable)
    }
}
/// Mounted owner and read-only reader admission. Upgrade verifies owner binding
/// through active_device or consumes a reader ticket; sync reads live authority.
/// The pinned local management member represents the owner across local pages.
#[derive(Clone)]
pub struct OwnerAdmission(pub std::sync::Arc<std::sync::Mutex<Registration>>);
impl OwnerAdmission {
    /// The socket supplies this forwarded context only for its actual upgraded
    /// peer. This parses the existing Remote context; it does not grant Colab
    /// write permission or turn a reader ticket into an owner.
    pub(crate) fn object_remote_binding(raw: &str) -> Result<(String, u64)> {
        let context = Context::parse(Some(raw))?;
        Ok((context.device_id, context.grant_revision))
    }
    pub(crate) fn recheck_object_remote(&self, raw: &str) -> Result<()> {
        self.0
            .lock()
            .map_err(|_| crate::sync::Code::Denied)?
            .active_device(Some(raw), now_ms()?)?;
        Ok(())
    }
    /// Actual owner/reader Session and historical recipient entitlement. The
    /// private peer owner supplies the principal; policy JSON cannot select it.
    pub(crate) fn attachment_context(
        &self,
        principal: &str,
        scope: &crate::sync::SyncScope,
        epoch: u64,
    ) -> Result<[u8; 32]> {
        use crate::sync::{Access, Admission, WrapRecipients};
        self.authorize(principal, scope, Access::Read)?;
        let service = self.0.lock().map_err(|_| crate::sync::Code::Denied)?;
        let current = values::decimal(&scope.epoch, false)?;
        if epoch == 0 || epoch > current || current - epoch >= 64 {
            return Err(crate::sync::Code::Denied.into());
        }
        let reader = service.readers.contains(principal);
        let recipients = if reader {
            service.readers.recipients(principal)?
        } else {
            WrapRecipients::Owner
        };
        let reader_context = if reader {
            Some(service.readers.attachment_context(principal)?)
        } else {
            None
        };
        service
            .store
            .owner_read(&scope.space, &service.keyring.owner_public(), |tx| {
                let head = tx.head().ok_or(crate::sync::Code::Denied)?;
                if matches!(recipients, WrapRecipients::None) {
                    let (_, log) =
                        crate::fold::verify_log(&tx.log()?, &service.keyring, &scope.page)?;
                    let published = log
                        .iter()
                        .rev()
                        .find_map(|p| match p {
                            tmt_colab_model::payload::Payload::PageShare(p)
                                if p.page_id == scope.page =>
                            {
                                Some(p)
                            }
                            _ => None,
                        })
                        .ok_or(crate::sync::Code::Denied)?;
                    let key = published
                        .published_keys
                        .as_ref()
                        .and_then(|keys| {
                            keys.as_slice()
                                .iter()
                                .find(|k| k.epoch == epoch.to_string())
                        })
                        .ok_or(crate::sync::Code::Denied)?;
                    if !matches!(published.mode, tmt_colab_model::payload::ShareMode::Public)
                        || values::binary(&key.key, 32)?.as_slice()
                            != tx
                                .epoch_secret(&scope.page, epoch)?
                                .ok_or(crate::sync::Code::Denied)?
                    {
                        return Err(crate::sync::Code::Denied.into());
                    }
                } else {
                    let recipient = match &recipients {
                        WrapRecipients::Owner => ("device", principal),
                        WrapRecipients::Link(id) => ("link", id.as_str()),
                        WrapRecipients::None => unreachable!(),
                    };
                    let recipient_key = match &recipients {
                        WrapRecipients::Owner => {
                            *certificate::Chain::from_json(
                                &tx.device(principal)?
                                    .ok_or(crate::sync::Code::Denied)?
                                    .chain,
                            )?
                            .certificate()?
                            .encryption_key
                        }
                        WrapRecipients::Link(id) => {
                            tx.recipient("link", id)?
                                .ok_or(crate::sync::Code::Denied)?
                                .encryption_key
                        }
                        WrapRecipients::None => unreachable!(),
                    };
                    let mut offset = 0;
                    let mut entitled = false;
                    loop {
                        let (wraps, more) = tx.wrap_page(
                            &scope.page,
                            current,
                            principal,
                            head,
                            offset,
                            &recipients,
                        )?;
                        if wraps.is_empty() && more {
                            return Err(crate::sync::Code::Denied.into());
                        }
                        offset += wraps.len();
                        if offset > 512 {
                            return Err(crate::sync::Code::Capacity.into());
                        }
                        for raw in wraps {
                            let envelope = tmt_colab_model::wrap::Envelope::from_json(
                                &values::binary(&raw, 2048)?,
                            )?;
                            envelope.verify_owner(&service.keyring.owner_public())?;
                            let h = envelope.header()?;
                            if h.space == scope.space
                                && h.page == scope.page
                                && h.epoch == epoch.to_string()
                                && h.recipient_kind == recipient.0
                                && h.recipient_id == recipient.1
                                && h.recipient_key == recipient_key
                                && values::decimal(&h.membership_revision, false)? <= head.revision
                            {
                                entitled = true;
                            }
                        }
                        if !more {
                            break;
                        }
                    }
                    if !entitled {
                        return Err(crate::sync::Code::Denied.into());
                    }
                }
                if let Some(context) = reader_context {
                    return Ok(context);
                }
                let row = tx
                    .registration(principal)?
                    .ok_or(crate::sync::Code::Denied)?;
                let device = tx.device(principal)?.ok_or(crate::sync::Code::Denied)?;
                Ok(crypto::digest(&framing::frame(&[
                    b"tmt-colab-attachment-owner-context-v1",
                    principal.as_bytes(),
                    &serde_json::to_vec(scope)?,
                    row.grant_revision.to_string().as_bytes(),
                    row.binding.as_deref().ok_or(crate::sync::Code::Denied)?,
                    &device.chain,
                ])?))
            })
    }
}
impl crate::sync::Admission for OwnerAdmission {
    fn device(&self, principal: &str) -> String {
        self.0
            .lock()
            .ok()
            .and_then(|service| service.readers.device(principal))
            .unwrap_or_else(|| principal.to_owned())
    }
    fn authorize_link_save(
        &self,
        device: &str,
        scope: &crate::sync::SyncScope,
    ) -> std::result::Result<(), crate::sync::Code> {
        use crate::sync::Code as SyncCode;
        // Only the link's own answer is a verdict. A lock, a clock or a store that fails says
        // nothing about the link, so the request is not refused for it.
        let service = self.0.lock().map_err(|_| SyncCode::ResyncRequired)?;
        if scope.space != service.keyring.space_id {
            return Err(SyncCode::Denied);
        }
        let now = (service.reader_clock)().map_err(|_| SyncCode::ResyncRequired)?;
        crate::readers::device_writer(&service.store, &service.keyring, scope, device, now)
            .map_err(|code| match code {
                Code::Expired => SyncCode::Expired,
                Code::Denied | Code::Invalid => SyncCode::Denied,
                Code::Conflict | Code::Unavailable | Code::Capacity => SyncCode::ResyncRequired,
            })
            .and_then(|writer| writer.edits())
    }
    fn save_source(&self) -> Option<crate::page::save::SourceOpener> {
        self.0.lock().ok()?.save_source()
    }
    fn save_author(&self) -> crate::Result<[u8; 32]> {
        self.0
            .lock()
            .map_err(|_| crate::page::Fault::Unavailable)?
            .author_key()
    }
    fn commit_save(
        &mut self,
        job: &crate::publication::SignedJob,
        packet: &[u8],
        chain: &[u8],
        now: u64,
        combine_until: std::time::Instant,
    ) -> crate::Result<crate::sync::Commit> {
        self.0
            .lock()
            .map_err(|_| crate::page::Fault::Unavailable)?
            .publish(job, packet, chain, now, combine_until)
    }
    fn save_status(
        &self,
        page: &str,
        operation_id: &str,
    ) -> crate::Result<crate::page::save::SaveResult> {
        self.0
            .lock()
            .map_err(|_| crate::page::Fault::Unavailable)?
            .save_status(page, operation_id)
    }
    fn create_child(
        &mut self,
        page: &str,
        operation_id: &str,
        title: &str,
        source: &str,
        blocks: bool,
        now: u64,
    ) -> crate::Result<()> {
        self.0
            .lock()
            .map_err(|_| crate::page::Fault::Unavailable)?
            .create_child(page, operation_id, title, source, blocks, now)
    }
    fn usage(&mut self, page: &str) -> crate::Result<crate::page::PageUsage> {
        self.0
            .lock()
            .map_err(|_| crate::page::Fault::Unavailable)?
            .usage(page)
    }
    fn compact(
        &mut self,
        page: &str,
        until: std::time::Instant,
    ) -> crate::Result<crate::page::compact::Report> {
        self.0
            .lock()
            .map_err(|_| crate::page::Fault::Unavailable)?
            .compact(page, until)
    }

    fn alive(&self, principal: &str) -> std::result::Result<(), crate::sync::Code> {
        let service = self.0.lock().map_err(|_| crate::sync::Code::Denied)?;
        if service.readers.contains(principal) {
            service
                .readers
                .check(
                    principal,
                    None,
                    &service.store,
                    &service.keyring,
                    (service.reader_clock)().map_err(|_| crate::sync::Code::Denied)?,
                )
                .map_err(reader_sync_error)?;
        }
        Ok(())
    }

    fn catchup_context(
        &self,
        principal: &str,
        scope: &crate::sync::SyncScope,
        store: &Store,
    ) -> std::result::Result<crate::sync::CatchupContext, crate::sync::Code> {
        let mut service = self.0.lock().map_err(|_| crate::sync::Code::Denied)?;
        let reader = service.readers.contains(principal);
        let needs_wrap = service
            .store
            .owner_read(&scope.space, &service.keyring.owner_public(), |tx| {
                let head = tx.head().ok_or(crate::sync::Code::Denied)?;
                let policy = tx.page_policy_at(&scope.page, head.revision)?;
                if policy.deleted {
                    return Err(crate::sync::Code::Denied.into());
                }
                if reader || tx.page_epoch(&scope.page)?.as_deref() != Some(scope.epoch.as_str()) {
                    return Ok(false);
                }
                tx.missing_device_wrap(&scope.page, &policy, principal)
            })
            .map_err(|error| sync_fault(error.as_ref()))?;
        if needs_wrap {
            let Registration { store, keyring, .. } = &mut *service;
            store
                .device_transaction(&scope.space, &keyring.owner_public(), |tx| {
                    let row = tx
                        .registration(principal)?
                        .ok_or(crate::sync::Code::Denied)?;
                    let device = tx.device(principal)?.ok_or(crate::sync::Code::Denied)?;
                    if row.revoked || device.revoked {
                        return Err(crate::sync::Code::Denied.into());
                    }
                    let binding: DeviceRegistration =
                        serde_json::from_slice(&row.binding.ok_or(crate::sync::Code::Denied)?)?;
                    let chain = certificate::Chain::from_json(&device.chain)?;
                    let cert = chain.certificate()?;
                    let (initial, member, revision) = issuer(tx, keyring)?;
                    verify_device(
                        &chain,
                        &cert,
                        &initial,
                        &member,
                        &binding,
                        revision,
                        &scope.space,
                    )?;
                    let now = now_ms()?;
                    let policy = tx.page_policy_at(&scope.page, revision)?;
                    if cert.device_id != principal
                        || now < cert.issued_at
                        || now >= cert.expires_at
                        || policy.deleted
                        || tx.page_epoch(&scope.page)?.as_deref() != Some(scope.epoch.as_str())
                    {
                        return Err(crate::sync::Code::Denied.into());
                    }
                    forward_page_wraps(
                        tx,
                        keyring,
                        principal,
                        &binding.encryption,
                        &scope.page,
                        &policy,
                        crate::limits::OWNER_WRAPS,
                    )?;
                    Ok(vec![])
                })
                .map_err(|error| sync_fault(error.as_ref()))?;
        }
        Ok(crate::sync::CatchupContext {
            membership_head: store
                .owner_head(&scope.space, &service.keyring.owner_public())
                .map_err(|error| sync_fault(error.as_ref()))?
                .ok_or(crate::sync::Code::Denied)?,
            baseline: store
                .baseline(
                    &scope.page,
                    values::decimal(&scope.epoch, false).map_err(|_| crate::sync::Code::Denied)?,
                )
                .map_err(|error| sync_fault(error.as_ref()))?
                .map(|baseline| baseline.descriptor),
            owner_key: service.keyring.owner_public(),
            recipients: if service.readers.contains(principal) {
                service
                    .readers
                    .check(
                        principal,
                        Some(scope),
                        &service.store,
                        &service.keyring,
                        (service.reader_clock)().map_err(|_| crate::sync::Code::Denied)?,
                    )
                    .map_err(reader_sync_error)?;
                service
                    .readers
                    .recipients(principal)
                    .map_err(reader_sync_error)?
            } else {
                crate::sync::WrapRecipients::Owner
            },
        })
    }

    fn authorize(
        &self,
        principal: &str,
        scope: &crate::sync::SyncScope,
        access: crate::sync::Access<'_>,
    ) -> std::result::Result<[u8; 32], crate::sync::Code> {
        use crate::sync::Code as SyncCode;
        let service = self.0.lock().map_err(|_| SyncCode::Denied)?;
        if scope.space != service.keyring.space_id {
            return Err(SyncCode::Denied);
        }
        let now = now_ms().map_err(|_| SyncCode::Denied)?;
        if service.readers.contains(principal) {
            service
                .readers
                .check(
                    principal,
                    Some(scope),
                    &service.store,
                    &service.keyring,
                    (service.reader_clock)().map_err(|_| SyncCode::Denied)?,
                )
                .map_err(reader_sync_error)?;
            // A link session reads; it stores its own originals only while the link's role may
            // write them. Everything else a writer does (`Save`, `Publish`) is denied to every
            // link: an editor link asks for a text change with an `edit-request` record.
            return match access {
                crate::sync::Access::Read => Ok([0; 32]),
                crate::sync::Access::Save | crate::sync::Access::Publish => Err(SyncCode::Denied),
                access => service
                    .readers
                    .writer(
                        principal,
                        scope,
                        &service.store,
                        &service.keyring,
                        (service.reader_clock)().map_err(|_| SyncCode::Denied)?,
                    )
                    .map_err(reader_sync_error)
                    .and_then(|writer| writer.admit(&access)),
            };
        }
        service
            .store
            .owner_read(&scope.space, &service.keyring.owner_public(), |tx| {
                let row = tx.registration(principal)?.ok_or(SyncCode::Denied)?;
                if row.revoked {
                    return Err(SyncCode::Denied.into());
                }
                let binding: DeviceRegistration =
                    serde_json::from_slice(&row.binding.ok_or(SyncCode::Denied)?)?;
                let device = tx.device(principal)?.ok_or(SyncCode::Denied)?;
                if device.revoked {
                    return Err(SyncCode::Denied.into());
                }
                let chain = certificate::Chain::from_json(&device.chain)?;
                let cert = chain.certificate()?;
                let head = tx.head().ok_or(SyncCode::Denied)?;
                let member = &head.owner_member;
                let issuer = tx
                    .recipient("member", &member.id)?
                    .ok_or(SyncCode::Denied)?;
                if issuer.revoked
                    || issuer.role.as_deref() != Some("editor")
                    || issuer.signing_key != member.signing_key
                    || issuer.encryption_key != member.encryption_key
                    || cert.device_id != principal
                    || cert.space != scope.space
                    || cert.issuer_kind != "member"
                    || cert.issuer_id != member.id
                    || cert.signing_key != &binding.signing
                    || cert.encryption_key != &binding.encryption
                    || values::decimal(cert.membership_revision, false)? > head.revision
                {
                    return Err(SyncCode::Denied.into());
                }
                if now < cert.issued_at || now >= cert.expires_at {
                    return Err(SyncCode::Expired.into());
                }
                let policy = tx.page_policy_at(&scope.page, head.revision)?;
                if policy.deleted
                    || (policy.archived
                        && matches!(
                            access,
                            crate::sync::Access::Append(_)
                                | crate::sync::Access::Write
                                | crate::sync::Access::Save
                                | crate::sync::Access::Publish
                        ))
                {
                    return Err(SyncCode::Denied.into());
                }
                if tx.page_epoch(&scope.page)?.as_deref() != Some(scope.epoch.as_str()) {
                    return Err(SyncCode::StaleEpoch.into());
                }
                if let crate::sync::Access::Append(c) = access {
                    let cited = values::decimal(&c.membership_revision, false)?;
                    if cited > head.revision
                        || cited < values::decimal(cert.membership_revision, false)?
                        || !matches!(c.namespace.as_str(), "content" | "own")
                    {
                        return Err(SyncCode::Denied.into());
                    }
                    // A session admitted before the head moved seals at the head it knew. Every
                    // authority fact above is read at the head, so the append stands when the
                    // statements it missed are all scoped to other pages. Any other change, while
                    // the device is still authorised, is a stale view and no verdict on the device:
                    // ask it to catch up, never `DENIED`, which the browser treats as lost access.
                    if cited < head.revision
                        && !tx.unrelated_since(&scope.page, cited, head.revision)?
                    {
                        return Err(SyncCode::ResyncRequired.into());
                    }
                }
                Ok(binding.signing)
            })
            .map_err(|error| sync_fault(error.as_ref()))
    }
}

/// Registration admission already authenticated the owner device and its pinned keys.
/// Wrap additions share its device transaction; failed capacity/signing publishes none.
fn forward_owner_wraps(
    tx: &mut OwnerTransaction<'_>,
    key: &Keyring,
    device: &str,
    recipient_key: &[u8; 32],
) -> Result<()> {
    let mut remaining = crate::limits::OWNER_WRAPS;
    for (page, policy) in tx.owner_wrap_pages()? {
        if remaining == 0 {
            break;
        }
        remaining -= forward_page_wraps(tx, key, device, recipient_key, &page, &policy, remaining)?;
    }
    Ok(())
}
fn forward_page_wraps(
    tx: &mut OwnerTransaction<'_>,
    key: &Keyring,
    device: &str,
    recipient_key: &[u8; 32],
    page: &str,
    policy: &crate::fold::PagePolicy,
    limit: usize,
) -> Result<usize> {
    let revision = tx.head().ok_or(Code::Unavailable)?.revision;
    let mut added = 0;
    let epochs = tx.recent_secrets(page, policy.epoch)?;
    for (epoch, mut secret) in epochs.into_iter().rev() {
        let result = (|| -> Result<()> {
            if added == limit
                || (policy.history_current && epoch != policy.epoch)
                || tx.device_wrap_exists(page, epoch, device, recipient_key)?
            {
                return Ok(());
            }
            added += 1;
            tx.put_wrap(&key.seal_wrap(
                &tmt_colab_model::wrap::Header {
                    space: key.space_id.clone(),
                    page: page.to_owned(),
                    epoch: epoch.to_string(),
                    recipient_kind: "device".into(),
                    recipient_id: device.into(),
                    recipient_key: *recipient_key,
                    signer_key: key.owner_public(),
                    membership_revision: revision.to_string(),
                },
                &secret,
            )?)?;
            Ok(())
        })();
        secret.fill(0);
        result?;
    }
    Ok(added)
}

fn issuer(
    tx: &OwnerTransaction<'_>,
    keyring: &Keyring,
) -> Result<(statement::Envelope, statement::OwnerMember, u64)> {
    let head = tx.head().ok_or(Code::Unavailable)?;
    let member = keyring.management_member()?;
    if head.owner_member != member {
        return Err(Code::Unavailable.into());
    }
    let initial = tx.statement(1)?.ok_or(Code::Unavailable)?;
    let verified = initial.verify_next(&keyring.space_id, &keyring.owner_public(), None)?;
    if verified.head.owner_member != member {
        return Err(Code::Unavailable.into());
    }
    let issuer = tx
        .recipient("member", &member.id)?
        .ok_or(Code::Unavailable)?;
    if issuer.revoked
        || issuer.signing_key != member.signing_key
        || issuer.encryption_key != member.encryption_key
        || issuer.role.as_deref() != Some("editor")
    {
        return Err(Code::Denied.into());
    }
    Ok((initial, member, head.revision))
}
fn verify_device(
    chain: &certificate::Chain,
    cert: &certificate::Certificate<'_>,
    initial: &statement::Envelope,
    member: &statement::OwnerMember,
    binding: &DeviceRegistration,
    revision: u64,
    space: &str,
) -> Result<()> {
    if cert.device_id != binding.context.device_id || cert.space != space {
        return Err(Code::Denied.into());
    }
    if cert.issuer_kind != "member"
        || cert.issuer_id != member.id
        || cert.signing_key != &binding.signing
        || cert.encryption_key != &binding.encryption
        || values::decimal(cert.membership_revision, false)? > revision
    {
        return Err(Code::Denied.into());
    }
    chain.verify(&initial.hash()?, cert, &member.signing_key)?;
    Ok(())
}
fn map_error(error: Box<dyn std::error::Error + Send + Sync>) -> Code {
    error
        .downcast_ref::<Code>()
        .copied()
        .unwrap_or(Code::Unavailable)
}

pub(crate) fn now_ms() -> std::result::Result<u64, Code> {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Code::Unavailable)?
        .as_millis()
        .try_into()
        .map_err(|_| Code::Unavailable)
}

/// What a peer is told when an admission read fails. A refusal the store answered keeps its code;
/// a store that could not be read (another connection held it past the busy timeout) is no
/// verdict on the device, so the peer resyncs instead of being denied (#2956).
fn sync_fault(error: &(dyn std::error::Error + 'static)) -> crate::sync::Code {
    if let Some(code) = error.downcast_ref::<crate::sync::Code>() {
        return *code;
    }
    if crate::store::contended(error) {
        crate::sync::Code::ResyncRequired
    } else {
        crate::sync::Code::Denied
    }
}

fn reader_sync_error(code: Code) -> crate::sync::Code {
    match code {
        Code::Expired => crate::sync::Code::Expired,
        _ => crate::sync::Code::Denied,
    }
}

#[cfg(test)]
mod describe_tests {
    use super::*;
    use crate::summary::{Summary, SummaryProjection};

    #[test]
    fn design_extra_declares_its_root_family_without_changing_the_primary() {
        let primary = Registration::navigation_description(DescribeFeatures::default());
        let mut described = Registration::navigation_description(DescribeFeatures {
            modules: true,
            home: false,
        });
        let modules = described
            .as_object_mut()
            .unwrap()
            .remove("modules")
            .unwrap();
        assert_eq!(described, primary);
        assert_eq!(modules[0]["id"], "design");
        assert_eq!(modules[0]["rootAppFamily"], "/design");
        assert_eq!(modules[0]["entry"], "/assets/colab-module.js");
    }

    #[test]
    fn colab_claims_home_only_for_a_remote_that_admits_it() {
        let primary = Registration::navigation_description(DescribeFeatures::default());
        assert!(primary.get("homePage").is_none());
        let mut claimed =
            Registration::navigation_description(DescribeFeatures::parse(Some("modules, home")));
        assert_eq!(claimed["homePage"], "/work");
        claimed.as_object_mut().unwrap().remove("homePage");
        claimed.as_object_mut().unwrap().remove("modules");
        assert_eq!(claimed, primary);
        assert_eq!(
            DescribeFeatures::parse(Some("homepage")),
            DescribeFeatures::default()
        );
    }

    #[test]
    fn owner_ticket_repository_uses_the_canonical_project_and_stays_out_of_local_list() {
        use crate::projects::Change;
        use serde_json::json;
        let root =
            std::env::temp_dir().join(format!("colab-ticket-repository-{}", std::process::id()));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let _cleanup = Cleanup(root.clone());
        let layout = crate::keyring::Layout::open(&root).unwrap();
        let key = Keyring::open(&layout).unwrap();
        let store = Store::open(&layout).unwrap();
        let page = "10000000-0000-4000-8000-000000000001";
        store.create_page(page).unwrap();
        let mut service = Registration::new(store, key, "/unused-decoder".into()).unwrap();
        service.genesis().unwrap();
        let space = service.keyring.space_id.clone();
        let owner = service.keyring.owner_public();
        service
            .store
            .device_transaction(&space, &owner, |tx| {
                tx.put_epoch_secret(page, 1, &[1; 32])?;
                Ok(Vec::new())
            })
            .unwrap();
        service
            .set_projects(&[(page.into(), vec!["Zeta".into(), "Alpha".into()])])
            .unwrap();
        for (name, repo) in [("Zeta", "other/repo"), ("Alpha", "tmt-ninja/tmt")] {
            service
                .manage_project(&Change::Repository {
                    name: name.into(),
                    repo: Some(repo.into()),
                })
                .unwrap();
        }
        let context = |owner: bool| {
            json!({
                "deviceId":"00000000-0000-4000-8000-000000000009",
                "kind":"browser",
                "origin":"http://127.0.0.1:1",
                "name":"Laptop",
                "publicKey":values::encode_binary(&service.keyring.owner_public()),
                "owner":owner,
                "grantRevision":1,
            })
            .to_string()
        };
        let list: serde_json::Value =
            serde_json::from_slice(&service.pages(Some(&context(true))).unwrap()).unwrap();
        assert_eq!(list["pages"][0]["ticketRepository"], "tmt-ninja/tmt");
        assert!(matches!(
            service.pages(Some(&context(false))),
            Err(Code::Denied)
        ));
        let local: serde_json::Value =
            serde_json::from_slice(&service.local_pages().unwrap()).unwrap();
        assert!(local["pages"][0].get("ticketRepository").is_none());
    }

    #[test]
    fn cached_page_list_token_observes_own_and_other_connection_commits() {
        use serde_json::json;
        let root =
            std::env::temp_dir().join(format!("colab-token-generation-{}", std::process::id()));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let _cleanup = Cleanup(root.clone());
        let layout = crate::keyring::Layout::open(&root).unwrap();
        let key = Keyring::open(&layout).unwrap();
        let store = Store::open(&layout).unwrap();
        let mut service = Registration::new(store, key, "/unused-decoder".into()).unwrap();
        service.genesis().unwrap();
        let context = json!({"deviceId":"00000000-0000-4000-8000-000000000009","kind":"browser",
            "origin":"http://127.0.0.1:1","name":"Laptop",
            "publicKey":values::encode_binary(&service.keyring.owner_public()),
            "owner":true,"grantRevision":1})
        .to_string();
        let token = || service.page_list_token(Some(&context)).unwrap();
        let initial = token();
        assert_eq!(token(), initial);
        service
            .store
            .create_page("10000000-0000-4000-8000-000000000001")
            .unwrap();
        let own = token();
        assert_ne!(own, initial);
        assert_eq!(token(), own);

        // A pre-commit read must not cache a token past another connection's later commit.
        let other = rusqlite::Connection::open(layout.directory.join("space.db")).unwrap();
        other.execute_batch("BEGIN IMMEDIATE").unwrap();
        other
            .execute(
                "INSERT INTO pages(page,epoch) VALUES (?1,'1')",
                ["10000000-0000-4000-8000-000000000002"],
            )
            .unwrap();
        assert_eq!(token(), own);
        other.execute_batch("COMMIT").unwrap();
        let committed = token();
        assert_ne!(committed, own);
        assert_eq!(token(), committed);
        drop(other);
        // A content stream append to an existing page, as a CLI patch publishes, also moves it.
        let mut writer = Store::open(&layout).unwrap();
        writer
            .append(&crate::store::Envelope {
                scope: crate::store::StreamScope {
                    page: "10000000-0000-4000-8000-000000000001",
                    epoch: 1,
                    stream: "20000000-0000-4000-8000-000000000001",
                },
                namespace: crate::store::Namespace::Content,
                seq: 1,
                hash: [1; 32],
                previous: [0; 32],
                bytes: b"test content update",
            })
            .unwrap();
        let changed_content = token();
        assert_ne!(changed_content, committed);
        assert_eq!(token(), changed_content);
        writer.close().unwrap();
    }

    #[test]
    fn work_section_progress_fits_at_the_page_limit() {
        use serde_json::json;
        let root = std::env::temp_dir().join(format!("colab-work-progress-{}", std::process::id()));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let _cleanup = Cleanup(root.clone());
        let layout = crate::keyring::Layout::open(&root).unwrap();
        let key = Keyring::open(&layout).unwrap();
        let store = Store::open(&layout).unwrap();
        for index in 0..crate::limits::PAGES {
            store
                .create_page(&format!("00000000-0000-4000-8000-{index:012}"))
                .unwrap();
        }
        let mut service =
            Registration::new(store, key, std::path::PathBuf::from("/unused-decoder")).unwrap();
        service.genesis().unwrap();
        let (_, fingerprints) = service.owner_catalog_fingerprinted().unwrap();
        let mut projection = SummaryProjection::from(Summary {
            comments: 0,
            waiting: false,
            needs_you: 0,
            author: None,
            work: None,
        });
        let title = "x".repeat(crate::sections::SECTION_TITLE);
        let blocks: serde_json::Map<String, serde_json::Value> = (0..crate::sections::SECTIONS)
            .map(|index| {
                (
                    format!("h{index}"),
                    json!({
                        "type":"heading","parent":"root","pos":format!("{index:03}"),
                        "props":{"level":2,"progress":"done"},"text":{"s":title,"marks":[]}
                    }),
                )
            })
            .collect();
        projection.sections = crate::sections::sections(Some(&blocks.into())).0;
        projection.todo_items = (0..crate::limits::WORK_TODOS)
            .map(|index| crate::summary::TodoItem {
                id: format!("t{index}"),
                text: "x".repeat(crate::limits::WORK_TODO_TEXT),
                checked: false,
                due: None,
                assignee: None,
                ask: None,
            })
            .collect();
        for (page, fingerprint) in &fingerprints {
            service
                .summaries
                .put(page, fingerprint, Some(projection.clone()));
        }
        let bytes = service.local_pages().unwrap();
        assert!(bytes.len() <= crate::limits::DISCOVERY_BYTES);
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let rows = value["pages"].as_array().unwrap();
        assert_eq!(rows.len(), crate::limits::PAGES);
        let expected = json!({"done":64,"inProgress":0,"todo":0,"unknown":0,"total":64});
        assert!(
            rows.iter()
                .all(|row| row["summary"]["sectionProgress"] == expected)
        );
        assert!(
            rows.iter()
                .any(|row| row["summary"]["sectionsOmitted"] == true)
        );
        assert!(
            rows.iter()
                .any(|row| row["summary"]["todosOmitted"] == true)
        );
        service.close().unwrap();
    }

    /// A page's work row and parent are resolved across the pages the cache holds fresh.
    #[test]
    fn the_owner_list_resolves_work_and_parent_across_fresh_pages_only() {
        use serde_json::json;
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "colab-list-work-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let _cleanup = Cleanup(root.clone());
        let layout = crate::keyring::Layout::open(&root).unwrap();
        let key = Keyring::open(&layout).unwrap();
        let store = Store::open(&layout).unwrap();
        let (top, leaf, bare, unread) = (
            "00000000-0000-4000-8000-000000000002",
            "00000000-0000-4000-8000-000000000003",
            "00000000-0000-4000-8000-000000000004",
            "00000000-0000-4000-8000-000000000005",
        );
        for page in [top, leaf, bare, unread] {
            store.create_page(page).unwrap();
        }
        let mut service =
            Registration::new(store, key, std::path::PathBuf::from("/unused-decoder")).unwrap();
        service.genesis().unwrap();
        let context = json!({"deviceId":"00000000-0000-4000-8000-000000000009","kind":"browser",
            "origin":"http://127.0.0.1:1","name":"Laptop",
            "publicKey":values::encode_binary(&service.keyring.owner_public()),
            "owner":true,"grantRevision":1})
        .to_string();
        let (_, fingerprints) = service.owner_catalog_fingerprinted().unwrap();
        // `top` still holds a task-era value: a plain finished task and one that follows `leaf`.
        // Unmigrated, it reads `leaf` as its one sub-page; `leaf` is done.
        let work = |tasks: serde_json::Value, order: serde_json::Value, next: u32| json!({"work": {"version":1,"next":next,"tasks":tasks,"order":order}});
        let top_work = work(
            json!({
                "T-1":{"title":"Leaf","state":"todo","child":leaf},
                "T-2":{"title":"Own","state":"done"}
            }),
            json!(["T-1", "T-2"]),
            3,
        );
        let leaf_work = json!({"pageState":"done"});
        let put = |page: &str, fingerprint: &str, meta: Option<&serde_json::Value>| {
            service.summaries.put(
                page,
                fingerprint,
                Some(SummaryProjection::from(Summary {
                    comments: 0,
                    waiting: false,
                    needs_you: 0,
                    author: None,
                    work: meta.and_then(crate::work_index::page_work).map(Box::new),
                })),
            )
        };
        put(top, &fingerprints[top], Some(&top_work));
        put(leaf, &fingerprints[leaf], Some(&leaf_work));
        put(bare, &fingerprints[bare], Some(&json!({})));
        // A retained computed status reaches the list only for the page's current fingerprint.
        service
            .store
            .remember_work_status(
                bare,
                &fingerprints[bare],
                &json!({"pageId":bare,"state":"waiting-ci"}),
            )
            .unwrap();
        service
            .store
            .remember_work_status(
                top,
                "an older fingerprint",
                &json!({"pageId":top,"state":"done"}),
            )
            .unwrap();
        let rows =
            |service: &Registration| -> std::collections::BTreeMap<String, serde_json::Value> {
                let list: serde_json::Value =
                    serde_json::from_slice(&service.pages(Some(&context)).unwrap()).unwrap();
                list["pages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|page| (page["pageId"].as_str().unwrap().to_owned(), page.clone()))
                    .collect()
            };
        let list = rows(&service);
        // `leaf` is done, so `top`'s one direct sub-page is done; the plain task does not count.
        assert_eq!(
            list[top]["summary"]["work"],
            json!({"stage":"done","done":1,"total":1})
        );
        assert!(list[leaf]["summary"].get("work").is_none());
        assert_eq!(
            list[leaf]["summary"]["parent"],
            json!({"page":top,"index":0})
        );
        assert_eq!(list[top]["state"], "todo");
        assert!(list[top].get("progress").is_none());
        assert_eq!(list[leaf]["state"], "done");
        let details: serde_json::Value = serde_json::from_slice(
            &service
                .page_summary_details(Some(&context), top, false)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(details["pageState"], "todo");
        assert_eq!(
            details["progress"],
            json!({"done":1,"inProgress":0,"todo":0,"unknown":0,"total":1})
        );
        // A fresh page without work has a summary and neither field; a page without a fresh summary
        // has no summary at all.
        assert!(list[bare]["summary"].get("work").is_none());
        assert!(list[bare]["summary"].get("parent").is_none());
        assert_eq!(list[bare]["state"], "todo");
        assert!(list[bare].get("progress").is_none());
        assert!(list[top]["summary"].get("parent").is_none());
        assert!(list[unread].get("summary").is_none());
        assert_eq!(list[bare]["summary"]["status"], "waiting-ci");
        assert!(list[bare]["summary"].get("release").is_none());
        // Without a retained status for its fingerprint, the list derives one from the fold
        // alone; this fixture's fold extracted no PR links, so its facts are unavailable.
        assert_eq!(list[top]["summary"]["status"], "unknown");
        assert!(list[unread].get("summary").is_none());

        // Work home data (#6474): a blocked page keeps the time it was first seen blocked, and
        // each to-do lists with the time it was first seen checked; unchecking clears it.
        let todo = |id: &str, checked: bool| crate::summary::TodoItem {
            id: id.to_owned(),
            text: format!("Item {id}"),
            checked,
            due: (id == "t1").then(|| "2026-11-22".to_owned()),
            assignee: checked.then(|| "gui-3".to_owned()),
            ask: None,
        };
        let work_home = |checked: bool| {
            let mut projection = SummaryProjection::from(Summary {
                comments: 0,
                waiting: false,
                needs_you: 0,
                author: None,
                work: crate::work_index::page_work(&json!({"blocked":"Waiting on Core"}))
                    .map(Box::new),
            });
            projection.todo_items = vec![todo("t1", checked), todo("t2", false)];
            // Its sections (#6619): a counted one carries its count and fold-decided state; a
            // plain heading is left out of the list.
            projection.sections = crate::sections::sections(Some(&json!({
                "h1": {"type":"heading","parent":"root","pos":"a","props":{"level":2},"text":{"s":"Plan","marks":[]}},
                "t1": {"type":"todo","parent":"root","pos":"b","props":{"checked":checked},"text":{"s":"","marks":[]}},
                "t2": {"type":"todo","parent":"root","pos":"c","props":{"checked":false},"text":{"s":"","marks":[]}},
                "h2": {"type":"heading","parent":"root","pos":"d","props":{"level":2},"text":{"s":"About","marks":[]}},
            })))
            .0;
            service
                .summaries
                .put(bare, &fingerprints[bare], Some(projection));
        };
        work_home(true);
        let first = rows(&service);
        let since = first[bare]["summary"]["blockedSinceMs"].as_u64().unwrap();
        // The stamp is the page's last activity when the row has one, never later than this read.
        let stamped = |at: u64| match first[bare]["lastUpdateAtMs"].as_u64() {
            Some(last) => assert_eq!(at, last),
            None => assert!(at <= now_ms().unwrap()),
        };
        stamped(since);
        assert_eq!(
            first[bare]["summary"]["sections"],
            json!([{"id":"h1","title":"Plan","level":2,"done":1,"total":2,"state":"working"}])
        );
        assert!(first[bare]["summary"].get("sectionsOmitted").is_none());
        let todos = &first[bare]["summary"]["todos"];
        assert_eq!(todos[0]["text"], "Item t1");
        assert_eq!(todos[0]["due"], "2026-11-22");
        assert!(todos[1].get("due").is_none());
        assert_eq!(todos[0]["assignee"], "gui-3");
        let done_at = todos[0]["doneAtMs"].as_u64().unwrap();
        stamped(done_at);
        assert!(todos[1].get("doneAtMs").is_none() && todos[1].get("assignee").is_none());
        assert!(first[bare]["summary"].get("doneAtMs").is_none());
        let again = rows(&service);
        assert_eq!(again[bare]["summary"]["blockedSinceMs"], since);
        assert_eq!(again[bare]["summary"]["todos"][0]["doneAtMs"], done_at);
        work_home(false);
        assert!(
            rows(&service)[bare]["summary"]["todos"][0]
                .get("doneAtMs")
                .is_none()
        );
        put(bare, &fingerprints[bare], Some(&json!({})));
        assert!(
            rows(&service)[bare]["summary"]
                .get("blockedSinceMs")
                .is_none()
        );

        // A retained fact that proved a release names it on the row (#6474 Work home).
        service
            .store
            .remember_work_status(
                bare,
                &fingerprints[bare],
                &json!({"pageId":bare,"state":"done","pulls":[
                    {"url":"https://github.com/o/r/pull/1","fact":{"released":false,"tag":null}},
                    {"url":"https://github.com/o/r/pull/2","fact":{"released":true,"tag":"v1.2.0"}}
                ]}),
            )
            .unwrap();
        assert_eq!(rows(&service)[bare]["summary"]["release"], "v1.2.0");

        // The sub-page goes stale: its state is unknown, so it no longer counts as done.
        put(leaf, "stale fingerprint", Some(&leaf_work));
        let list = rows(&service);
        assert_eq!(list[top]["summary"]["work"]["stage"], "in-progress");
        assert_eq!(list[top]["summary"]["work"]["done"], 0);
        assert!(list[leaf].get("summary").is_none());
        assert!(list[top].get("progress").is_none());
        let details: serde_json::Value = serde_json::from_slice(
            &service
                .page_summary_details(Some(&context), top, false)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            details["progress"],
            json!({"done":0,"inProgress":0,"todo":0,"unknown":1,"total":1})
        );
    }

    /// An equivocating stream freezes a page's epoch; the owner list still names the page, without
    /// a revision, and the other pages keep theirs (#6162).
    #[test]
    fn the_owner_list_names_a_frozen_page_without_a_revision() {
        use serde_json::json;
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "colab-list-frozen-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let _cleanup = Cleanup(root.clone());
        let layout = crate::keyring::Layout::open(&root).unwrap();
        let key = Keyring::open(&layout).unwrap();
        let store = Store::open(&layout).unwrap();
        let (live, frozen) = (
            "00000000-0000-4000-8000-000000000002",
            "00000000-0000-4000-8000-000000000003",
        );
        for page in [live, frozen] {
            store.create_page(page).unwrap();
        }
        let mut service =
            Registration::new(store, key, std::path::PathBuf::from("/unused-decoder")).unwrap();
        service.genesis().unwrap();
        let context = json!({"deviceId":"00000000-0000-4000-8000-000000000009","kind":"browser",
            "origin":"http://127.0.0.1:1","name":"Laptop",
            "publicKey":values::encode_binary(&service.keyring.owner_public()),
            "owner":true,"grantRevision":1})
        .to_string();
        rusqlite::Connection::open(layout.directory.join("space.db"))
            .unwrap()
            .execute(
                "INSERT INTO streams(page,epoch,stream,frozen)
                 SELECT page,epoch,'10000000-0000-4000-8000-000000000001',1 FROM pages WHERE page=?",
                [frozen],
            )
            .unwrap();
        let list: serde_json::Value =
            serde_json::from_slice(&service.pages(Some(&context)).unwrap()).unwrap();
        let row = |id: &str| {
            list["pages"]
                .as_array()
                .unwrap()
                .iter()
                .find(|page| page["pageId"] == id)
                .cloned()
                .unwrap()
        };
        assert!(row(frozen).get("revision").is_none());
        assert_eq!(
            row(live)["revision"],
            json!(crate::page::revision(&service.store, &service.keyring, live).unwrap())
        );
    }

    #[test]
    fn describe_offers_home_cards_only_for_pages_with_a_current_projected_title() {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "colab-home-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let _cleanup = Cleanup(root.clone());
        let layout = crate::keyring::Layout::open(&root).unwrap();
        let store = Store::open(&layout).unwrap();
        let key = Keyring::open(&layout).unwrap();
        let mut service =
            Registration::new(store, key, std::path::PathBuf::from("/unused-decoder")).unwrap();
        let pages: Vec<String> = (2..=8)
            .map(|n| format!("00000000-0000-4000-8000-00000000000{n}"))
            .collect();
        for page in &pages {
            service.store.create_page(page).unwrap();
        }
        service.genesis().unwrap();
        let space = service.keyring.space_id.clone();
        let owner = service.keyring.owner_public();
        service
            .store
            .device_transaction(&space, &owner, |tx| {
                for page in &pages {
                    tx.put_epoch_secret(page, 1, &[1; 32])?;
                }
                Ok(b"open".to_vec())
            })
            .unwrap();
        let (_, fingerprints) = service.owner_catalog_fingerprinted().unwrap();
        let home = |service: &Registration| -> serde_json::Value {
            serde_json::from_slice::<serde_json::Value>(
                &service.describe(DescribeFeatures::default()).unwrap(),
            )
            .unwrap()
            .get("home")
            .cloned()
            .unwrap_or_default()
        };
        // No projected title yet: no card and no placeholder.
        assert_eq!(home(&service), serde_json::Value::Null);
        let long = "A title that runs well past the forty scalars a card shows";
        for (n, page) in pages.iter().enumerate().skip(1) {
            let title = if n == 1 {
                long.to_owned()
            } else {
                format!("Page {n}")
            };
            let recorded = service
                .store
                .project_transaction(&space, &owner, |tx| {
                    tx.record_page_title(page, &fingerprints[page.as_str()], &title)
                })
                .unwrap();
            assert!(recorded, "{page}");
        }
        let cards = home(&service);
        let cards = cards.as_array().unwrap();
        // At most five cards; the page without a title (pages[0]) is never one.
        assert_eq!(cards.len(), HOME_CARDS);
        assert!(
            cards
                .iter()
                .all(|card| card["path"] != format!("/pages/{}", pages[0]))
        );
        for card in cards {
            let title = card["title"].as_str().unwrap();
            assert!(title.chars().count() <= CARD_TITLE_SCALARS, "{title}");
            let id = card["path"].as_str().unwrap().trim_start_matches("/pages/");
            assert_eq!(card["id"], id.replace('-', ""));
        }
        assert_eq!(card_title(long).chars().count(), CARD_TITLE_SCALARS);
        assert!(card_title(long).ends_with('\u{2026}'));
        assert_eq!(card_title("Page 3"), "Page 3");
    }

    #[test]
    fn describe_matches_active_waiting_pages_and_omits_unknown_counts() {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "colab-describe-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let _cleanup = Cleanup(root.clone());
        let layout = crate::keyring::Layout::open(&root).unwrap();
        let key = Keyring::open(&layout).unwrap();
        let store = Store::open(&layout).unwrap();
        let active = "00000000-0000-4000-8000-000000000002";
        let archived = "00000000-0000-4000-8000-000000000003";
        store.create_page(active).unwrap();
        store.create_page(archived).unwrap();
        let mut service =
            Registration::new(store, key, std::path::PathBuf::from("/unused-decoder")).unwrap();
        service.genesis().unwrap();
        let key = &service.keyring;
        let payload = serde_json::to_vec(&serde_json::json!({"pageId":archived})).unwrap();
        service
            .store
            .owner_transaction(
                &key.space_id,
                &key.owner_public(),
                Mutation {
                    operation_id: "00000000-0000-4000-8000-000000000004",
                    digest: crypto::digest(&payload),
                    expected_revision: 1,
                },
                |tx| {
                    let statement = key.sign_statement(tx.head(), "page.archive", &payload)?;
                    tx.append_statement(&statement)?;
                    Ok(statement.to_json()?)
                },
            )
            .unwrap();
        let (catalog, fingerprints) = service.owner_catalog_fingerprinted().unwrap();
        assert!(
            catalog["pages"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["pageId"] == archived && p["archived"] == true)
        );
        let put = |page: &str, fingerprint: &str, count| {
            service.summaries.put(
                page,
                fingerprint,
                Some(SummaryProjection::from(Summary {
                    comments: 0,
                    waiting: count > 0,
                    needs_you: count,
                    author: None,
                    work: None,
                })),
            )
        };
        put(active, &fingerprints[active], 2);
        put(archived, "stale fingerprint", 2);
        let answer: serde_json::Value = serde_json::from_slice(
            &service
                .describe(DescribeFeatures::default())
                .expect("archived stale summaries are irrelevant"),
        )
        .unwrap();
        assert_eq!(answer["menu"][0]["count"]["value"], 1);
        assert_eq!(
            answer["needsYou"], 1,
            "two items on one waiting page count once"
        );
        put(archived, &fingerprints[archived], 2);
        let answer: serde_json::Value =
            serde_json::from_slice(&service.describe(DescribeFeatures::default()).unwrap())
                .unwrap();
        assert_eq!(answer["menu"][0]["count"]["value"], 1);
        assert_eq!(
            answer["needsYou"], 1,
            "fresh archived waiting pages are excluded too"
        );
        for fingerprint in [fingerprints[active].as_str(), "old fingerprint"] {
            service.summaries.put(active, fingerprint, None);
            let answer: serde_json::Value =
                serde_json::from_slice(&service.describe(DescribeFeatures::default()).unwrap())
                    .unwrap();
            assert_eq!(answer["rail"]["label"], "Colab");
            assert!(answer.get("needsYou").is_none());
            assert_eq!(
                answer["menu"][0]["count"]["value"], 1,
                "catalog count stays known"
            );
            assert!(
                service
                    .summaries
                    .get(active, &fingerprints[active])
                    .is_none(),
                "describe cannot refresh the cache"
            );
        }
        put(active, &fingerprints[active], 0);
        let answer: serde_json::Value =
            serde_json::from_slice(&service.describe(DescribeFeatures::default()).unwrap())
                .unwrap();
        assert_eq!(answer["needsYou"], 0, "known zero remains a number");
        let oracle = rusqlite::Connection::open(layout.directory.join("space.db")).unwrap();
        oracle
            .execute("UPDATE membership_log SET envelope=x'00'", [])
            .unwrap();
        assert_eq!(
            service.describe(DescribeFeatures::default()),
            Err(Code::Unavailable),
            "a broken catalog still refuses"
        );
        drop(oracle);
        service.close().unwrap();
    }
}
