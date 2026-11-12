//! Synthetic injected input/plan/record proofs only. Never spawns a deploy command.
use tmt_remote::{deploy_cli, deploy_input::Values};
fn parse(extra: &[&str]) -> deploy_cli::FirestoreArgs {
    let mut words = vec![
        "firestore",
        "--project",
        "demo-remote-1",
        "--region",
        "asia-east1",
        "--defaults",
    ];
    words.extend_from_slice(extra);
    deploy_cli::arguments(&deploy_cli::command().try_get_matches_from(words).unwrap()).unwrap()
}
#[test]
fn spark_defaults_input_bytes_are_unchanged_and_have_no_storage_permissions() {
    let args = parse(&[]);
    let inputs = deploy_cli::inputs::resolve(&args, None, &Values::new(), &[]).unwrap();
    assert_eq!(serde_json::to_vec(&inputs).unwrap(), br#"{"project":"demo-remote-1","region":"asia-east1","database":"(default)","webApp":"new","site":"new","signIn":["anonymous"]}"#);
    assert!(inputs.storage.is_none());
    let mut permissions = Vec::new();
    deploy_cli::inputs::include_storage(&mut permissions, false, true);
    assert!(permissions.is_empty());
}
#[test]
fn defaults_never_supply_paid_bucket_or_permanent_location() {
    for flags in [
        vec!["--storage", "blaze"],
        vec!["--storage", "blaze", "--bucket", "default"],
    ] {
        let args = parse(&flags);
        assert!(deploy_cli::inputs::resolve(&args, None, &Values::new(), &[]).is_err());
    }
    let args = parse(&[
        "--storage",
        "blaze",
        "--bucket",
        "default",
        "--bucket-location",
        "us-east1",
    ]);
    let inputs = deploy_cli::inputs::resolve(&args, None, &Values::new(), &[]).unwrap();
    assert_eq!(
        inputs.storage.unwrap().location.as_deref(),
        Some("us-east1")
    );
    assert_eq!(inputs.region, "asia-east1");
}
#[test]
fn named_linked_bucket_intent_needs_no_invented_location() {
    let args = parse(&[
        "--storage",
        "blaze",
        "--bucket",
        "fake-storage-fixture.invalid",
    ]);
    let inputs = deploy_cli::inputs::resolve(&args, None, &Values::new(), &[]).unwrap();
    assert_eq!(inputs.storage.unwrap().location, None);
    let mut permissions = Vec::new();
    deploy_cli::inputs::include_storage(&mut permissions, true, false);
    assert!(
        !permissions
            .iter()
            .any(|p| p.permission == "firebasestorage.defaultBucket.create")
    );
    deploy_cli::inputs::include_storage(&mut permissions, true, true);
    assert!(
        permissions
            .iter()
            .any(|p| p.permission == "firebasestorage.defaultBucket.create")
    );
}
#[test]
fn bucket_or_consent_without_opt_in_is_refused_before_provider_construction() {
    for flags in [
        vec!["--accept-paid-storage"],
        vec!["--bucket", "fake-storage-fixture.invalid"],
    ] {
        let args = parse(&flags);
        assert!(deploy_cli::inputs::validate_supplied(&args).is_err());
    }
}
#[test]
fn optional_capability_has_strict_version_and_is_not_a_grant() {
    let capability = tmt_remote::deploy_storage::StorageCapability {
        version: 1,
        bucket: "fake-storage-fixture.invalid".into(),
        location: "us-east1".into(),
    };
    assert!(capability.valid());
    let mut unknown = capability.clone();
    unknown.version = 2;
    assert!(!unknown.valid());
    assert!(serde_json::from_value::<tmt_remote::deploy_storage::StorageCapability>(serde_json::json!({"version":1,"bucket":capability.bucket,"location":capability.location,"grant":true})).is_err());
}
#[allow(dead_code)]
#[path = "support/deploy_fixture.rs"]
mod deploy_fixture;
#[allow(dead_code)]
#[path = "support/deploy_port.rs"]
mod deploy_port;
use deploy_run::{
    DeployApplied, DeployObserved, DeployPort, DeployProviderError, StepKind, StorageStep,
};
use tmt_remote::{deploy_plan, deploy_record, deploy_run, deploy_storage};
struct StorageFake {
    inner: deploy_port::Fake,
    storage: Option<deploy_storage::StorageCheckpoint>,
    unknown_without_effect: Option<String>,
    record_path: std::path::PathBuf,
    applied: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}
impl StorageFake {
    fn refresh(&mut self, plan: &deploy_run::DeployPlan) {
        let cp = self.storage.as_mut().unwrap();
        if self.inner.present.contains("storage:bucket") {
            cp.metadata_digest = Some(fixture_sha(b"synthetic metadata"));
        }
        if self.inner.present.contains("storage:ruleset") {
            cp.ruleset = Some(format!(
                "projects/{}/rulesets/synthetic-ruleset",
                plan.view().project
            ));
        }
    }
}
impl DeployPort for StorageFake {
    fn account(&mut self) -> Result<String, DeployProviderError> {
        self.inner.account()
    }
    fn restore_storage(&mut self, cp: &deploy_storage::StorageCheckpoint) {
        self.storage = Some(cp.clone());
    }
    fn storage_checkpoint(&self) -> Option<deploy_storage::StorageCheckpoint> {
        self.storage.clone()
    }
    fn observe(
        &mut self,
        plan: &deploy_run::DeployPlan,
        step: &deploy_run::DeployStep,
    ) -> Result<DeployObserved, DeployProviderError> {
        if step.kind == StepKind::Storage(StorageStep::Eligibility) {
            self.inner.present.insert(step.id.clone());
        }
        self.refresh(plan);
        let observed = self.inner.observe(plan, step)?;
        if step.kind == StepKind::Verify {
            self.storage.as_mut().unwrap().verified = observed == DeployObserved::Satisfied;
        }
        Ok(observed)
    }
    fn apply(
        &mut self,
        plan: &deploy_run::DeployPlan,
        step: &deploy_run::DeployStep,
    ) -> Result<DeployApplied, DeployProviderError> {
        self.applied
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        // This read is independent of the in-memory runner: intent must already be on disk.
        let disk: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&self.record_path).unwrap()).unwrap();
        assert!(
            disk["record"]["run"]["steps"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["id"] == step.id && s["state"] == "unknown")
        );
        if self.unknown_without_effect.as_deref() == Some(&step.id) {
            self.unknown_without_effect = None;
            self.inner.calls.push(format!("apply:{}", step.id));
            return Err(DeployProviderError::Unknown);
        }
        self.inner.apply(plan, step)
    }
}
fn captured_storage() -> deploy_storage::StoragePlan {
    deploy_storage::StoragePlan {
        disclosure_version: 1,
        intent: deploy_storage::StorageIntent {
            bucket: "default".into(),
            location: Some("us-east1".into()),
        },
        bucket: "fake-storage-fixture.invalid".into(),
        location: "us-east1".into(),
        billing_fingerprint: "b".repeat(64),
        metadata_digest: fixture_sha(b"null"),
        bucket_metadata: serde_json::Value::Null,
        bucket_was_present: false,
        policy: deploy_storage::DENY_ALL_POLICY.into(),
        policy_digest: fixture_sha(deploy_storage::DENY_ALL_POLICY.as_bytes()),
        replaced_policy_digest: None,
    }
}
fn record_world(
    root: &deploy_fixture::Root,
) -> (
    deploy_record::DeployRecordStore,
    deploy_run::DeployPlan,
    StorageFake,
) {
    let layout = root.layout();
    let mut store = deploy_record::DeployRecordStore::open(
        &layout,
        "demo-storage-fixture",
        "synthetic record fixture",
    )
    .unwrap();
    let mut args = parse(&[]);
    args.project = "demo-storage-fixture".into();
    args.storage = Some("blaze".into());
    args.bucket = Some("default".into());
    args.bucket_location = Some("us-east1".into());
    let inputs = deploy_cli::inputs::resolve(&args, None, &Values::new(), &[]).unwrap();
    store.select_inputs(inputs).unwrap();
    let record = store.load_or_draft().unwrap();
    let extensions = deploy_plan::compose(
        deploy_plan::Target {
            backend: deploy_plan::CloudBackend::Firestore,
            physical_ttl: false,
        },
        &[],
    )
    .unwrap();
    let plan = deploy_run::prepare(
        &extensions,
        &deploy_run::DeployInput {
            account: "synthetic-owner@example.invalid",
            project: "demo-storage-fixture",
            deployment_id: &record.deployment_id,
            location: "asia-east1",
            sign_in: &[deploy_run::SignInProvider::Anonymous],
            rules_body: b"synthetic firestore policy",
            live_rules: None,
        },
    )
    .unwrap()
    .with_storage(captured_storage())
    .unwrap();
    let fake = StorageFake {
        inner: deploy_port::Fake::new("synthetic-owner@example.invalid"),
        storage: None,
        applied: std::sync::Arc::default(),
        unknown_without_effect: None,
        record_path: root
            .remote()
            .join("deployments")
            .join("demo-storage-fixture")
            .join("deploy.json"),
    };
    (store, plan, fake)
}
#[test]
fn paid_plan_requires_both_gates_before_any_provider_observation_or_effect() {
    let root = deploy_fixture::Root::new();
    let (mut store, plan, mut fake) = record_world(&root);
    let record = store.load_or_draft().unwrap();
    let authorization = deploy_run::authorize(&plan, plan.digest()).unwrap();
    assert!(matches!(
        deploy_run::run(&plan, &authorization, record, &mut fake, &mut store, 1),
        Err(deploy_run::DeployError::Refused(
            deploy_run::DeployRefusal::PaidStorageConsentRequired
        ))
    ));
    assert!(fake.inner.calls.is_empty());
    for change in 0..3 {
        let mut changed = captured_storage();
        match change {
            0 => changed.billing_fingerprint = "c".repeat(64),
            1 => changed.location = "us-west1".into(),
            _ => changed.bucket = "another-fake-storage.invalid".into(),
        }
        if change == 1 {
            changed.intent.location = Some(changed.location.clone());
        }
        let mut candidate = plan.clone().with_storage(changed).unwrap();
        // Replacing already-inserted Storage steps does not duplicate them.
        assert_eq!(
            candidate
                .steps()
                .iter()
                .filter(|s| matches!(s.kind, StepKind::Storage(_)))
                .count(),
            4
        );
        assert!(deploy_run::authorize(&candidate, plan.digest()).is_err());
        let _ = &mut candidate;
    }
}
#[test]
fn durable_storage_unknown_reopen_observes_without_a_second_mutation() {
    for failed in ["storage:bucket", "storage:ruleset", "storage:release"] {
        let root = deploy_fixture::Root::new();
        let (mut store, plan, mut fake) = record_world(&root);
        fake.inner
            .faults
            .insert(failed.into(), deploy_port::When::AfterEffectUnknown);
        let auth = deploy_run::authorize(&plan, plan.digest())
            .unwrap()
            .with_paid_storage(true);
        let record = store.load_or_draft().unwrap();
        let partial = deploy_run::run(&plan, &auth, record, &mut fake, &mut store, 1).unwrap();
        assert_eq!(
            partial.run.as_ref().unwrap().state,
            deploy_run::RunState::Partial
        );
        assert!(partial.verified_storage().is_none());
        assert_eq!(fake.inner.effects_of(failed), 1);
        drop(store);
        let layout = root.layout();
        let mut reopened = deploy_record::DeployRecordStore::open(
            &layout,
            "demo-storage-fixture",
            "synthetic reopen",
        )
        .unwrap();
        let original = reopened.load_or_draft().unwrap();
        assert!(
            original
                .run
                .as_ref()
                .unwrap()
                .steps
                .iter()
                .any(|s| s.id == failed && s.state == deploy_run::StepState::Unknown)
        );
        let complete =
            deploy_run::run(&plan, &auth, original, &mut fake, &mut reopened, 2).unwrap();
        assert_eq!(
            complete.run.as_ref().unwrap().state,
            deploy_run::RunState::Complete
        );
        assert!(complete.verified_storage().is_some());
        assert_eq!(fake.inner.effects_of(failed), 1);
        assert_eq!(
            fake.inner
                .calls
                .iter()
                .filter(|c| *c == &format!("apply:{failed}"))
                .count(),
            1
        );
    }
}
#[test]
fn absence_after_an_unknown_storage_call_never_authorizes_another_post() {
    let root = deploy_fixture::Root::new();
    let (mut store, plan, mut fake) = record_world(&root);
    fake.unknown_without_effect = Some("storage:bucket".into());
    let auth = deploy_run::authorize(&plan, plan.digest())
        .unwrap()
        .with_paid_storage(true);
    let record = store.load_or_draft().unwrap();
    let partial = deploy_run::run(&plan, &auth, record, &mut fake, &mut store, 1).unwrap();
    drop(store);
    let layout = root.layout();
    let mut store =
        deploy_record::DeployRecordStore::open(&layout, "demo-storage-fixture", "synthetic reopen")
            .unwrap();
    let record = store.load_or_draft().unwrap();
    assert_eq!(record, partial);
    let stopped = deploy_run::run(&plan, &auth, record, &mut fake, &mut store, 2).unwrap();
    assert!(stopped.verified_storage().is_none());
    assert_eq!(
        fake.inner
            .calls
            .iter()
            .filter(|c| *c == "apply:storage:bucket")
            .count(),
        1
    );
}

fn fixture_sha(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[test]
fn a_changed_plan_cannot_abandon_any_unknown_storage_mutation() {
    for failed in ["storage:bucket", "storage:ruleset", "storage:release"] {
        let root = deploy_fixture::Root::new();
        let (mut store, plan, mut fake) = record_world(&root);
        fake.inner
            .faults
            .insert(failed.into(), deploy_port::When::AfterEffectUnknown);
        let auth = deploy_run::authorize(&plan, plan.digest())
            .unwrap()
            .with_paid_storage(true);
        let original = store.load_or_draft().unwrap();
        let partial = deploy_run::run(&plan, &auth, original, &mut fake, &mut store, 1).unwrap();
        let mut changed = captured_storage();
        changed.billing_fingerprint = "c".repeat(64);
        let changed = plan.clone().with_storage(changed).unwrap();
        assert!(
            deploy_run::supersession_refusal(&changed, &partial).is_some(),
            "{failed}"
        );
        assert!(
            deploy_run::interactive_supersession_refusal(&changed, &partial).is_some(),
            "{failed}"
        );
    }
}
#[test]
fn incomplete_joint_readback_never_publishes_the_storage_capability() {
    let root = deploy_fixture::Root::new();
    let (mut store, plan, mut fake) = record_world(&root);
    fake.inner
        .observe_faults
        .insert("verify".into(), deploy_run::DeployProviderError::Unknown);
    let auth = deploy_run::authorize(&plan, plan.digest())
        .unwrap()
        .with_paid_storage(true);
    let original = store.load_or_draft().unwrap();
    let partial = deploy_run::run(&plan, &auth, original, &mut fake, &mut store, 1).unwrap();
    assert_eq!(
        partial.run.as_ref().unwrap().state,
        deploy_run::RunState::Partial
    );
    assert!(partial.verified_storage().is_none());
    assert!(tmt_remote::remote_link::from_record(&partial).is_err());
    drop(store);
    let store = deploy_record::DeployRecordStore::open(
        &root.layout(),
        "demo-storage-fixture",
        "synthetic reopen",
    )
    .unwrap();
    assert!(store.load_or_draft().unwrap().verified_storage().is_none());
}

impl deploy_cli::FirestoreCommandPort for StorageFake {
    fn login(&mut self) -> Result<(), tmt_remote::deploy_firestore::DeploySetupError> {
        Ok(())
    }
    fn check_permissions(
        &mut self,
        _: &str,
        permissions: &[&str],
    ) -> Result<Vec<String>, tmt_remote::deploy_firestore::DeployPreflightError> {
        Ok(permissions.iter().map(|name| (*name).to_owned()).collect())
    }
    fn check_index_budget(
        &mut self,
        _: &str,
        _: &deploy_plan::Plan,
    ) -> Result<Option<bool>, tmt_remote::deploy_firestore::DeployPreflightError> {
        Ok(Some(false))
    }
    fn live_rules(
        &mut self,
        _: &str,
    ) -> Result<Option<Vec<u8>>, tmt_remote::deploy_firestore::DeployPreflightError> {
        Ok(None)
    }
    fn storage_inventory(
        &mut self,
        _: &str,
        _: &deploy_storage::StorageIntent,
        _: Option<&deploy_storage::StorageCheckpoint>,
    ) -> Result<deploy_storage::StoragePlan, tmt_remote::deploy_firestore::DeployPreflightError>
    {
        Ok(captured_storage())
    }
}
struct FixtureDeclarations;
impl tmt_remote::deploy_discovery::DeclarationSource for FixtureDeclarations {
    fn declaration(
        &mut self,
        name: &str,
    ) -> Result<Option<Vec<u8>>, tmt_remote::deploy_discovery::DiscoveryRefusal> {
        assert_eq!(name, "colab");
        let declaration = include_str!("fixtures/rules/colab.json");
        Ok(Some(
            serde_json::to_vec(&serde_json::json!({
                "version":1,"extension":"colab","backend":"firestore",
                "declaration":declaration,"declarationDigest":fixture_sha(declaration.as_bytes()),
                "artifact":include_str!("fixtures/rules/colab.rules")
            }))
            .unwrap(),
        ))
    }
}
fn paid_args() -> deploy_cli::FirestoreArgs {
    let mut args = parse(&[
        "--storage",
        "blaze",
        "--bucket",
        "default",
        "--bucket-location",
        "us-east1",
    ]);
    args.project = "demo-storage-fixture".into();
    args
}
#[test]
fn injected_human_paid_and_plan_questions_are_ordered_and_declining_either_has_no_effect() {
    // false models both no and EOF at the existing terminal-reader seam.
    for responses in [vec![false], vec![true, false], vec![true, true]] {
        let root = deploy_fixture::Root::new();
        let (store, _, fake) = record_world(&root);
        drop(store);
        let applied = fake.applied.clone();
        let mut seen = Vec::new();
        let mut confirmation = |out: &tmt_remote::deploy_command::DeployCommandOutput| {
            let paid = out.json["paidStorageConsent"] == true;
            if paid {
                assert!(out.human.contains("blocks all current object access"));
                assert!(out.human.contains("fake-storage-fixture.invalid"));
            }
            seen.push(paid);
            Ok(responses[seen.len() - 1])
        };
        let out = deploy_cli::execute_with_confirmation(
            &paid_args(),
            &mut FixtureDeclarations,
            &["colab"],
            || Ok(fake),
            || Ok(root.layout()),
            || Ok(1),
            Some(&mut confirmation),
        )
        .unwrap();
        assert_eq!(
            seen,
            if responses.len() == 1 {
                vec![true]
            } else {
                vec![true, false]
            }
        );
        if responses.last() == Some(&false) {
            assert_eq!(out.json["declined"], true);
            assert_eq!(applied.load(std::sync::atomic::Ordering::SeqCst), 0);
        } else {
            assert_eq!(out.json["record"]["run"]["state"], "complete");
            assert!(applied.load(std::sync::atomic::Ordering::SeqCst) > 0);
        }
    }
}
#[test]
fn identified_agents_and_missing_paid_flag_refuse_with_one_preview_and_zero_effects() {
    for (agent, flag, authorize) in [
        (true, false, false),
        (true, true, true),
        (false, false, true),
    ] {
        let root = deploy_fixture::Root::new();
        let (store, _, fake) = record_world(&root);
        drop(store);
        let applied = fake.applied.clone();
        let mut args = paid_args();
        args.agent = agent;
        args.accept_paid_storage = flag;
        args.authorize = authorize.then(|| "a".repeat(12));
        args.json = true;
        let error = deploy_cli::execute(
            &args,
            &mut FixtureDeclarations,
            &["colab"],
            || Ok(fake),
            || Ok(root.layout()),
            || Ok(1),
        )
        .err()
        .expect("paid consent refusal");
        let deploy_cli::DeployCliError::Local(error) = error else {
            panic!("expected consent refusal")
        };
        assert_eq!(error.code, "REMOTE_DEPLOY_PAID_STORAGE_CONSENT_REQUIRED");
        let json = error.json_value();
        assert!(json["error"]["preview"].is_object());
        assert_eq!(json.as_object().unwrap().len(), 1);
        assert!(
            !serde_json::to_string(&json)
                .unwrap()
                .contains("billingAccounts/")
        );
        assert_eq!(applied.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}

struct RefuseIntentSave<'a> {
    store: &'a mut deploy_record::DeployRecordStore,
    target: &'a str,
}
impl deploy_run::DeploySink for RefuseIntentSave<'_> {
    fn save(
        &mut self,
        record: &deploy_run::DeployRecord,
    ) -> Result<(), deploy_run::DeploySinkError> {
        if record.run.as_ref().is_some_and(|run| {
            run.steps
                .iter()
                .any(|step| step.id == self.target && step.state == deploy_run::StepState::Unknown)
        }) {
            return Err(deploy_run::DeploySinkError);
        }
        deploy_run::DeploySink::save(self.store, record)
    }
}
#[test]
fn failed_durable_intent_save_prevents_each_storage_mutation() {
    for target in ["storage:bucket", "storage:ruleset", "storage:release"] {
        let root = deploy_fixture::Root::new();
        let (mut store, plan, mut fake) = record_world(&root);
        let auth = deploy_run::authorize(&plan, plan.digest())
            .unwrap()
            .with_paid_storage(true);
        let record = store.load_or_draft().unwrap();
        let mut sink = RefuseIntentSave {
            store: &mut store,
            target,
        };
        assert!(deploy_run::run(&plan, &auth, record, &mut fake, &mut sink, 1).is_err());
        assert_eq!(fake.inner.effects_of(target), 0, "{target}");
        assert!(
            !fake
                .inner
                .calls
                .iter()
                .any(|call| call == &format!("apply:{target}"))
        );
        assert!(store.load_or_draft().unwrap().verified_storage().is_none());
    }
}

#[test]
fn unchanged_unfinished_cli_consent_resumes_but_completed_consent_is_not_evergreen() {
    for explicit_digest in [false, true] {
        let root = deploy_fixture::Root::new();
        let (store, _, mut fake) = record_world(&root);
        drop(store);
        fake.inner.faults.insert(
            "storage:bucket".into(),
            deploy_port::When::AfterEffectUnknown,
        );
        let mut yes = |_: &tmt_remote::deploy_command::DeployCommandOutput| Ok(true);
        let partial = deploy_cli::execute_with_confirmation(
            &paid_args(),
            &mut FixtureDeclarations,
            &["colab"],
            || Ok(fake),
            || Ok(root.layout()),
            || Ok(1),
            Some(&mut yes),
        )
        .unwrap();
        assert_eq!(partial.json["record"]["run"]["state"], "partial");
        let (store, _, mut resumed_fake) = record_world(&root);
        let record = store.load_or_draft().unwrap();
        drop(store);
        for step in &record.run.as_ref().unwrap().steps {
            if matches!(
                step.state,
                deploy_run::StepState::Done | deploy_run::StepState::Adopted
            ) || step.id == "storage:bucket"
            {
                resumed_fake.inner.present.insert(step.id.clone());
            }
        }
        let mut args = paid_args();
        if explicit_digest {
            args.authorize = Some(record.run.as_ref().unwrap().plan_digest[..12].into());
            args.json = true;
        }
        let mut unexpected_question = |_: &tmt_remote::deploy_command::DeployCommandOutput| -> Result<bool, deploy_cli::DeployCliError> { panic!("unchanged unfinished plan already has both consents") };
        let complete = deploy_cli::execute_with_confirmation(
            &args,
            &mut FixtureDeclarations,
            &["colab"],
            || Ok(resumed_fake),
            || Ok(root.layout()),
            || Ok(2),
            (!explicit_digest)
                .then_some(&mut unexpected_question as &mut deploy_cli::PlanConfirmation<'_>),
        )
        .unwrap();
        assert_eq!(complete.json["record"]["run"]["state"], "complete");
        let (store, _, next) = record_world(&root);
        drop(store);
        let applied = next.applied.clone();
        let mut questions = 0;
        let mut no = |out: &tmt_remote::deploy_command::DeployCommandOutput| {
            assert_eq!(out.json["paidStorageConsent"], true);
            questions += 1;
            Ok(false)
        };
        let declined = deploy_cli::execute_with_confirmation(
            &paid_args(),
            &mut FixtureDeclarations,
            &["colab"],
            || Ok(next),
            || Ok(root.layout()),
            || Ok(3),
            Some(&mut no),
        )
        .unwrap();
        assert_eq!(questions, 1);
        assert_eq!(declined.json["declined"], true);
        assert_eq!(applied.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}
#[test]
fn policy_replacement_and_disclosure_are_bound_to_the_single_authorization_digest() {
    let root = deploy_fixture::Root::new();
    let (_, plan, _) = record_world(&root);
    let mut replaced = captured_storage();
    replaced.replaced_policy_digest = Some("f".repeat(64));
    let replacement = plan.clone().with_storage(replaced).unwrap();
    assert_ne!(replacement.digest(), plan.digest());
    assert!(
        replacement
            .view()
            .destructive
            .contains(&format!("replaces-storage-policy:{}", "f".repeat(64)))
    );
    assert!(deploy_run::authorize(&replacement, plan.digest()).is_err());
    let mut changed = captured_storage();
    changed.policy = "synthetic alternate policy".into();
    changed.policy_digest = fixture_sha(changed.policy.as_bytes());
    assert!(plan.clone().with_storage(changed).is_err());
    let mut changed = captured_storage();
    changed.disclosure_version = 2;
    assert!(plan.with_storage(changed).is_err());
}
