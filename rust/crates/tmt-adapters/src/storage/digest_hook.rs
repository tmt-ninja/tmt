//! Join an already host-verified launch fence with the canonical checklist claim.
use super::{
    IdentityContextSnapshot, Storage, StorageError, bindings::BindingRows,
    identities::with_immediate_transaction, requests::TransactionRequests,
};
use tmt_core::{
    binding::BindingRecords,
    request::{
        RequestError, RequestService,
        digest::{DigestChecklist, DigestOpportunity},
    },
};

impl Storage {
    /// Whether the provider still works on the continuation a Stop-hook checklist started: its
    /// activity reads idle until that continuation's own Stop (#4858).
    pub fn digest_continuation_open(&mut self, identity: &str) -> Result<bool, StorageError> {
        super::requests::digest_continuation_open(self.connection()?, identity)
    }

    pub fn claim_digest_for_launch(
        &mut self,
        expected: &IdentityContextSnapshot,
        id: String,
        token: String,
        through_limit: Option<u64>,
    ) -> Result<LaunchClaim, RequestError<StorageError>> {
        let calendar = super::orchestration::ReceivingCalendar::load(self.connection()?)?;
        with_immediate_transaction(self, "launch checklist", |transaction| {
            let rows = BindingRows(transaction);
            let identity = &expected.entry.identity.id;
            let current = rows.entry_by_id(identity)?;
            let preferences = rows.session_preferences(identity)?;
            // Telemetry may change in a simultaneous observation hook, the queue drain or a
            // compaction. Admission only depends on the exact binding/session/owner fence
            // and the remembered pair (#5459).
            let remembered = |prefs: &tmt_core::binding::session::SessionPreferences| {
                prefs
                    .remembered
                    .as_ref()
                    .map(|r| (r.harness.clone(), r.provider_session.clone()))
            };
            if current.as_ref().is_none_or(|entry| {
                entry.binding.as_ref().map(admission)
                    != expected.entry.binding.as_ref().map(admission)
            }) {
                return Ok(LaunchClaim::BindingChanged);
            }
            if remembered(&preferences) != remembered(&expected.preferences) {
                return Ok(LaunchClaim::RememberedChanged);
            }
            let mut requests = TransactionRequests(transaction, &calendar);
            if let Some(summary) =
                RequestService::new(&mut requests, crate::request_runtime::wall_time_ms)
                    .claim_digest_summary(
                        identity,
                        id.clone(),
                        token.clone(),
                        DigestOpportunity::TurnBoundary,
                        || true,
                    )?
            {
                return Ok(LaunchClaim::Claimed(summary));
            }
            let claimed = RequestService::new(&mut requests, crate::request_runtime::wall_time_ms)
                .claim_digest_checklist(
                    identity,
                    id,
                    token,
                    DigestOpportunity::TurnBoundary,
                    through_limit,
                )?;
            Ok(claimed.map_or(LaunchClaim::Nothing, LaunchClaim::Claimed))
        })
    }
}

/// What a launch's Digest claim found. Only an authority change refuses; finding nothing
/// to claim is not a refusal.
#[derive(Debug)]
pub enum LaunchClaim {
    Claimed(DigestChecklist),
    Nothing,
    /// The binding fence ([`admission`]) is not the launch's any more.
    BindingChanged,
    /// The remembered harness and provider session are not the launch's any more.
    RememberedChanged,
}

/// The part of a binding that authorizes a launch's Digest: which binding, endpoint and
/// pane, which provider session in which process, and its owner. A session's
/// `last_transition` and `start_refusal` are telemetry a hook may update at any time, never
/// authority, so they are left out.
#[allow(clippy::type_complexity)]
fn admission(
    binding: &tmt_core::binding::Binding,
) -> (
    (&str, &str, &tmt_core::endpoint::ServerEvidence),
    (&str, u64, Option<&str>),
    (
        tmt_core::binding::session::RuntimeState,
        Option<&tmt_core::binding::session::ObservedSessionKey>,
        Option<&tmt_core::endpoint::ProcessIncarnation>,
    ),
) {
    // Exhaustive on purpose: a new binding or session field must be placed on one side of
    // the fence here, never ignored by it.
    let tmt_core::binding::Binding {
        id,
        identity_id,
        server,
        pane_id,
        pane_pid,
        pane_incarnation,
        session,
    } = binding;
    let tmt_core::binding::session::BindingSessionState {
        // A plain program clears only with an agent's admission, which also replaces `key`.
        plain_program: _,
        // Lifecycle telemetry a hook rewrites on every transition, not who holds the launch.
        last_transition: _,
        state,
        key,
        launch_owner,
        // The latest refused start, a diagnostic only; a refusal changes no fence field.
        start_refusal: _,
    } = session;
    (
        (id, identity_id, server),
        (pane_id, *pane_pid, pane_incarnation.as_deref()),
        (*state, key.as_ref(), launch_owner.as_ref()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestDirectory;
    use tmt_core::identity::{Lifetime, create_or_resolve};

    fn fixture() -> (TestDirectory, std::path::PathBuf, String) {
        let directory = TestDirectory::new();
        let path = directory.path.join("digest.db");
        let mut storage = Storage::open(&path).unwrap();
        let id = create_or_resolve(&mut storage, "Focused", Lifetime::Saved)
            .unwrap()
            .identity
            .id;
        let db = storage.connection().unwrap();
        db.execute("INSERT INTO bindings(id,identity_id,transport,pane_id,server_id,socket_path,server_pid,server_start_time,pane_pid,bound_at,last_verified_at,runtime_state,runtime_pid,runtime_start_identity,observed_provider_session_id,launch_owner_pid,launch_owner_start_identity)
            VALUES('binding',?1,'tmux','%1','server','/fixture',10,'server-start',11,'original','original','running',12,'runtime-start','session',13,'owner-start')", [&id]).unwrap();
        db.execute("INSERT INTO identity_session_preferences(identity_id,remembered_harness,runtime_mode,provider_session_id) VALUES(?1,'claude','default','session')", [&id]).unwrap();
        let request = format!("req_{}", tmt_core::operation::new_operation_id());
        db.execute("INSERT INTO request_attempts(attempt_id,request_id,route_kind,wait_active,status,inject_preamble,cadence_reserved,prepared_at_ms,expires_at_ms,retention_expires_at_ms,originator_kind,recipient_identity_id)
            VALUES(?1,?1,'inbox',0,'queued',0,0,1,9007199254740991,9007199254740991,'unknown',?2)", rusqlite::params![request,id]).unwrap();
        db.execute("INSERT INTO focus_items(identity_id,request_id,kind,source,created_at_ms) VALUES(?1,?2,'review','incoming',1)", rusqlite::params![id,request]).unwrap();
        storage.close().unwrap();
        (directory, path, id)
    }

    fn claim(storage: &mut Storage, expected: &IdentityContextSnapshot) -> Option<DigestChecklist> {
        match outcome(storage, expected) {
            LaunchClaim::Claimed(checklist) => Some(checklist),
            _ => None,
        }
    }

    fn outcome(storage: &mut Storage, expected: &IdentityContextSnapshot) -> LaunchClaim {
        storage
            .claim_digest_for_launch(
                expected,
                tmt_core::operation::new_operation_id(),
                tmt_core::operation::new_operation_id(),
                None,
            )
            .unwrap()
    }

    #[test]
    fn each_changed_authority_refuses_before_sealing_and_telemetry_does_not() {
        for update in [
            "UPDATE bindings SET id='replacement'",
            "UPDATE bindings SET launch_owner_start_identity='other'",
            "UPDATE bindings SET runtime_start_identity='other'",
            "UPDATE bindings SET observed_provider_session_id='other'",
            "UPDATE bindings SET runtime_pid=99",
            "UPDATE bindings SET pane_id='%2'",
            "UPDATE bindings SET pane_pid=98",
            "UPDATE bindings SET server_start_time='other'",
            "UPDATE bindings SET runtime_state='unknown'",
            "UPDATE identity_session_preferences SET provider_session_id='other'",
            "UPDATE identity_session_preferences SET remembered_harness='codex'",
            "UPDATE identities SET retired_at_ms=1",
        ] {
            let (_directory, path, id) = fixture();
            let expected = Storage::context_by_identity(&path, &id, 1)
                .unwrap()
                .unwrap();
            let mut storage = Storage::open(&path).unwrap();
            storage.connection().unwrap().execute(update, []).unwrap();
            // Each names the authority that changed, so the worker can store why it refused.
            match outcome(&mut storage, &expected) {
                LaunchClaim::RememberedChanged => {
                    assert!(update.contains("identity_session_preferences"), "{update}")
                }
                LaunchClaim::BindingChanged => {
                    assert!(!update.contains("identity_session_preferences"), "{update}")
                }
                other => panic!("{update}: {other:?}"),
            }
            assert_eq!(
                storage
                    .connection()
                    .unwrap()
                    .query_row("SELECT COUNT(*) FROM focus_checklists", [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                storage
                    .connection()
                    .unwrap()
                    .query_row(
                        "SELECT COUNT(*) FROM focus_items WHERE checklist_id IS NULL",
                        [],
                        |row| row.get::<_, i64>(0)
                    )
                    .unwrap(),
                1
            );
            storage.close().unwrap();
        }
        let (_directory, path, id) = fixture();
        let expected = Storage::context_by_identity(&path, &id, 1)
            .unwrap()
            .unwrap();
        let mut storage = Storage::open(&path).unwrap();
        storage.connection().unwrap().execute("UPDATE identity_session_preferences SET driver_state_version=1,driver_state='{\"activity\":\"idle\"}'",[]).unwrap();
        assert!(claim(&mut storage, &expected).is_some());
        storage.close().unwrap();
    }

    #[test]
    fn a_volatile_session_write_between_snapshot_and_claim_still_claims() {
        for update in [
            "UPDATE bindings SET last_transition='compacted'",
            "UPDATE bindings SET runtime_start_refusal='{\"driver\":\"claude\",\"session\":\"other\",\"reason\":\"previous_session_live\",\"atMs\":1}'",
        ] {
            let (_directory, path, id) = fixture();
            let expected = Storage::context_by_identity(&path, &id, 1)
                .unwrap()
                .unwrap();
            let mut storage = Storage::open(&path).unwrap();
            storage.connection().unwrap().execute(update, []).unwrap();
            assert!(claim(&mut storage, &expected).is_some(), "{update}");
            storage.close().unwrap();
        }
    }

    #[test]
    fn concurrent_launch_claims_have_one_winner_and_one_sealed_inventory() {
        let (_directory, path, id) = fixture();
        let operations = [0, 1].map(|_| {
            let expected = Storage::context_by_identity(&path, &id, 1)
                .unwrap()
                .unwrap();
            Box::new(move |storage: &mut Storage| claim(storage, &expected))
                as super::super::test_support::Operation<Option<DigestChecklist>>
        });
        let results = super::super::test_support::concurrent_pair(&path, operations);
        assert_eq!(results.iter().filter(|value| value.is_some()).count(), 1);
        let mut storage = Storage::open(&path).unwrap();
        assert_eq!(
            storage
                .connection()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM focus_checklists WHERE state='claimed'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        assert_eq!(
            storage
                .connection()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM focus_items WHERE checklist_id IS NOT NULL",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        storage.close().unwrap();
    }

    /// The worker's storage steps at one turn boundary: the checklist it claims, or the step
    /// that ended empty and what the Stop would name for it.
    fn boundary(
        storage: &mut Storage,
        expected: &IdentityContextSnapshot,
    ) -> Result<DigestChecklist, (&'static str, Option<crate::digest::EmptyBoundary>)> {
        let id = &expected.entry.identity.id;
        let Some(through) = crate::digest::fitting_through(
            storage,
            id,
            tmt_core::request::digest::DigestOpportunity::TurnBoundary,
            false,
        )
        .unwrap() else {
            return Err((
                "fitting",
                crate::digest::empty_boundary(storage, id, false).unwrap(),
            ));
        };
        match storage
            .claim_digest_for_launch(
                expected,
                tmt_core::operation::new_operation_id(),
                tmt_core::operation::new_operation_id(),
                Some(through),
            )
            .unwrap()
        {
            LaunchClaim::Claimed(checklist) => Ok(checklist),
            LaunchClaim::Nothing => Err((
                "claim",
                crate::digest::empty_boundary(storage, id, true).unwrap(),
            )),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn an_empty_boundary_is_named_only_while_references_are_held() {
        use crate::digest::EmptyBoundary;
        // Nothing held: the Stop names nothing, so it writes nothing.
        let (_directory, path, id) = fixture();
        let expected = Storage::context_by_identity(&path, &id, 1)
            .unwrap()
            .unwrap();
        let mut storage = Storage::open(&path).unwrap();
        storage
            .connection()
            .unwrap()
            .execute("DELETE FROM focus_items", [])
            .unwrap();
        assert_eq!(
            boundary(&mut storage, &expected).unwrap_err(),
            ("fitting", None)
        );
        assert_eq!(
            crate::digest::empty_boundary(&mut storage, &id, true).unwrap(),
            None
        );
        storage.close().unwrap();

        // Held, but no reference is claimable at this boundary.
        let (_directory, path, id) = fixture();
        let expected = Storage::context_by_identity(&path, &id, 1)
            .unwrap()
            .unwrap();
        let mut storage = Storage::open(&path).unwrap();
        storage
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO identity_metadata(identity_id,key,value) VALUES(?1,?2,?3)",
                [
                    id.as_str(),
                    tmt_core::identity_metadata::USER_KEY,
                    tmt_core::identity_metadata::USER_VALUE,
                ],
            )
            .unwrap();
        assert_eq!(
            boundary(&mut storage, &expected).unwrap_err(),
            ("fitting", Some(EmptyBoundary::NotEligible))
        );
        storage.close().unwrap();

        // Fitted, then nothing claimable by the time the launch claims.
        let (_directory, path, id) = fixture();
        let expected = Storage::context_by_identity(&path, &id, 1)
            .unwrap()
            .unwrap();
        let mut storage = Storage::open(&path).unwrap();
        let through = crate::digest::fitting_through(
            &mut storage,
            &id,
            tmt_core::request::digest::DigestOpportunity::TurnBoundary,
            false,
        )
        .unwrap();
        assert!(through.is_some());
        storage
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO identity_metadata(identity_id,key,value) VALUES(?1,?2,?3)",
                [
                    id.as_str(),
                    tmt_core::identity_metadata::USER_KEY,
                    tmt_core::identity_metadata::USER_VALUE,
                ],
            )
            .unwrap();
        assert!(matches!(
            storage
                .claim_digest_for_launch(
                    &expected,
                    tmt_core::operation::new_operation_id(),
                    tmt_core::operation::new_operation_id(),
                    through,
                )
                .unwrap(),
            LaunchClaim::Nothing
        ));
        assert_eq!(
            crate::digest::empty_boundary(&mut storage, &id, true).unwrap(),
            Some(EmptyBoundary::ClaimNothing)
        );
        storage.close().unwrap();
    }

    /// #5459's lead hypothesis, isolated: a talk's idle handoff still holds its claim when
    /// the provider's turn boundary arrives.
    #[test]
    fn a_turn_boundary_behind_an_open_idle_claim_hands_off_nothing_and_names_it() {
        use crate::digest::EmptyBoundary;
        use tmt_core::request::{
            RequestService,
            digest::{DigestOpportunity, DigestState},
        };
        let (_directory, path, id) = fixture();
        let expected = Storage::context_by_identity(&path, &id, 1)
            .unwrap()
            .unwrap();
        let mut storage = Storage::open(&path).unwrap();
        let idle = RequestService::new(&mut storage, crate::request_runtime::wall_time_ms)
            .claim_digest_checklist(
                &id,
                tmt_core::operation::new_operation_id(),
                tmt_core::operation::new_operation_id(),
                DigestOpportunity::Idle,
                None,
            )
            .unwrap()
            .unwrap();
        let empty = boundary(&mut storage, &expected).unwrap_err();
        assert_eq!(empty, ("fitting", Some(EmptyBoundary::ActiveClaim)));
        // The boundary sealed nothing of its own and left the idle claim as it was.
        assert_eq!(
            storage
                .connection()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM focus_checklists WHERE state='claimed'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        // Once that handoff proves unsent, the held item is offered at the next boundary.
        RequestService::new(&mut storage, crate::request_runtime::wall_time_ms)
            .settle_digest_checklist(&id, &idle.id, &idle.attempt_token, DigestState::Unsent)
            .unwrap();
        assert!(boundary(&mut storage, &expected).is_ok());
        storage.close().unwrap();
    }
}
