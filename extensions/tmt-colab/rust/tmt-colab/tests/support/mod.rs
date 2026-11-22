//! Invocation headroom for semantic tests on loaded hosts.
use std::{path::PathBuf, time::Duration};
use tmt_colab::decoder::Config;

pub const DECODER_DEADLINE: Duration = Duration::from_secs(60);

pub fn decoder_config(program: PathBuf) -> Config {
    Config {
        program,
        deadline: DECODER_DEADLINE,
    }
}

/// An admitted non-CLI browser writer for isolated discussion fixtures.
#[allow(dead_code)]
pub struct BrowserDiscussion {
    database: rusqlite::Connection,
    doc: yrs::Doc,
    signer: ed25519_dalek::SigningKey,
    sequence: u64,
    previous: [u8; 32],
}

#[allow(dead_code)]
impl BrowserDiscussion {
    pub const ID: &str = "50000000-0000-4000-8000-0000000000bd";

    pub fn new(
        layout: &tmt_colab::keyring::Layout,
        store: &tmt_colab::store::Store,
        key: &tmt_colab::keyring::Keyring,
        now: u64,
    ) -> Self {
        use tmt_colab_model::{certificate, values, wrap};
        let signer = ed25519_dalek::SigningKey::from_bytes(&[0xbd; 32]);
        let head = store
            .owner_head(&key.space_id, &key.owner_public())
            .unwrap()
            .unwrap();
        let database = rusqlite::Connection::open(layout.directory.join("space.db")).unwrap();
        let genesis: Vec<u8> = database
            .query_row(
                "SELECT envelope FROM membership_log ORDER BY revision LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let issuer = tmt_colab_model::statement::Envelope::from_json(&genesis)
            .unwrap()
            .hash()
            .unwrap();
        let device = certificate::Certificate {
            space: &key.space_id,
            issuer_kind: "member",
            issuer_id: &head.owner_member.id,
            device_id: Self::ID,
            signing_key: &signer.verifying_key().to_bytes(),
            encryption_key: &wrap::RecipientKey::from_seed(&[0xbe; 32])
                .unwrap()
                .public_key(),
            membership_revision: "1",
            issued_at: now,
            expires_at: now + 86_400_000,
        };
        let device = tmt_colab::store::owner::Device {
            revoked: false,
            chain: serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "issuerStatement": values::encode_binary(&issuer),
                "deviceCertificate": values::encode_binary(&certificate::input(&device).unwrap()),
                "issuerSignature": values::encode_binary(&key.sign_device_certificate(&device).unwrap()),
            })).unwrap(),
        };
        database
            .execute(
                "INSERT INTO devices VALUES (?,?)",
                rusqlite::params![Self::ID, serde_json::to_vec(&device).unwrap()],
            )
            .unwrap();
        Self {
            database,
            doc: yrs::Doc::new(),
            signer,
            sequence: 0,
            previous: [0; 32],
        }
    }

    pub fn append(
        &mut self,
        store: &mut tmt_colab::store::Store,
        key: &tmt_colab::keyring::Keyring,
        page: &str,
        records: &[tmt_colab::decoder::OwnRecord],
    ) {
        use tmt_colab::store::{Accepted, Envelope, Namespace, StreamScope};
        use tmt_colab_model::object;
        use yrs::{Map, ReadTxn, Transact};
        let revision = store
            .owner_head(&key.space_id, &key.owner_public())
            .unwrap()
            .unwrap()
            .revision;
        let secret: Vec<u8> = self
            .database
            .query_row(
                "SELECT secret FROM epoch_secrets WHERE page=? AND epoch=?",
                rusqlite::params![page, format!("{:020}", 1)],
                |row| row.get(0),
            )
            .unwrap();
        let secret: [u8; 32] = secret.try_into().unwrap();
        let base = self.doc.transact().state_vector();
        for record in records {
            assert_eq!(record.value["senderDevice"], Self::ID);
            self.doc.get_or_insert_map(record.root.as_str()).insert(
                &mut self.doc.transact_mut(),
                record.key.as_str(),
                yrs::Any::from_json(&record.value.to_string()).unwrap(),
            );
        }
        let bytes = self.doc.transact().encode_state_as_update_v1(&base);
        self.sequence += 1;
        let envelope = object::seal(
            &object::Context {
                space: key.space_id.clone(),
                page: page.into(),
                epoch: "1".into(),
                kind: "update".into(),
                namespace: "own".into(),
                author_device: Self::ID.into(),
                membership_revision: revision.to_string(),
                stream_seq: self.sequence.to_string(),
                prev_hash: self.previous,
            },
            &secret,
            &self.signer,
            &bytes,
        )
        .unwrap();
        let hash = envelope.hash().unwrap();
        assert_eq!(
            store
                .append(&Envelope {
                    scope: StreamScope {
                        page,
                        epoch: 1,
                        stream: Self::ID
                    },
                    namespace: Namespace::Own,
                    seq: self.sequence,
                    hash,
                    previous: self.previous,
                    bytes: &envelope.to_bytes().unwrap(),
                })
                .unwrap(),
            Accepted::New
        );
        self.previous = hash;
    }
}
