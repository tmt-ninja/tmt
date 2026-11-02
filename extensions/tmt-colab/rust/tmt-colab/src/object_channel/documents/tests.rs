use super::*;
const PAGE: &str = "10000000-0000-4000-8000-000000000001";
const STREAM: &str = "20000000-0000-4000-8000-000000000001";
fn string(value: &str) -> Field {
    Field::String(value.into())
}
fn log() -> Fields {
    Fields::from_iter([
        ("space".into(), string(&"a".repeat(32))),
        ("page".into(), string(PAGE)),
        ("epoch".into(), Field::number(1).unwrap()),
        ("stream".into(), string(STREAM)),
        ("seq".into(), Field::number(1).unwrap()),
        ("uid".into(), string("owner")),
        ("hash".into(), string(&values::encode_binary(&[7; 32]))),
        ("envelope".into(), string("{\"signed\":\"original\"}")),
        (
            "expiresAt".into(),
            Field::Timestamp("2026-10-15T00:00:00Z".into()),
        ),
    ])
}
#[test]
fn log_roundtrip_keeps_exact_original_bytes_and_page_bound_id() {
    let fields = log();
    let doc = encode(Resource::Log, fields.clone()).unwrap();
    assert_eq!(
        doc.target.id,
        format!("{}_{}_1_{}_1", "a".repeat(32), PAGE, STREAM)
    );
    assert_eq!(
        doc.fields["envelope"],
        json!({"stringValue":"{\"signed\":\"original\"}"})
    );
    assert_eq!(decode(Resource::Log, &doc).unwrap(), fields);
    let mut forged = doc.clone();
    forged
        .fields
        .insert("envelope".into(), json!({"stringValue":"changed"}));
    assert!(decode(Resource::Log, &forged).is_err());
    let mut wrong_page = doc.clone();
    wrong_page.target.id.push('a');
    assert!(decode(Resource::Log, &wrong_page).is_err());
    assert!(decode(Resource::Authority, &doc).is_err());
}
#[test]
fn the_largest_sealed_update_the_decoder_admits_is_one_log_document() {
    // A request is one own update of at most `UPDATE_BYTES` sealed; hosted, it is exactly one
    // log create, because the document limit holds that envelope with its routing fields.
    let mut fields = log();
    fields.insert(
        "envelope".into(),
        string(&"x".repeat(crate::limits::UPDATE_BYTES)),
    );
    assert!(encode(Resource::Log, fields.clone()).is_ok());
    fields.insert(
        "envelope".into(),
        string(&"x".repeat(tmt_extension_objects::limits::SYNC_DOCUMENT_BYTES)),
    );
    assert!(encode(Resource::Log, fields).is_err());
}
#[test]
fn mappings_match_the_single_declaration_owner() {
    let declaration: Value =
        serde_json::from_str(include_str!("../../../../../firestore/declaration.json")).unwrap();
    for resource in [
        Resource::Spaces,
        Resource::Pages,
        Resource::Links,
        Resource::Members,
        Resource::Log,
        Resource::Checkpoints,
        Resource::Authority,
    ] {
        let spec = declaration["resources"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["name"] == resource.name())
            .unwrap();
        let declared: std::collections::BTreeSet<_> = spec["sync"]["fields"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(declared, resource.fields().iter().copied().collect());
    }
}
#[test]
fn log_refuses_missing_extra_wrong_type_and_noncanonical_numbers() {
    for (key, value) in [
        ("extra", string("not declared")),
        ("seq", Field::Integer("01".into())),
        ("seq", Field::Integer("9007199254740992".into())),
        ("seq", Field::Integer("0".into())),
        ("envelope", string("multibyte é")),
        ("hash", string("short")),
        ("expiresAt", string("2026-10-15T00:00:00Z")),
    ] {
        let mut fields = log();
        fields.insert(key.into(), value);
        assert!(encode(Resource::Log, fields).is_err(), "{key}");
    }
    let mut fields = log();
    fields.remove("uid");
    assert!(encode(Resource::Log, fields).is_err());
}
#[test]
fn full_envelope_boundary_is_exact() {
    let mut fields = log();
    fields.insert(
        "envelope".into(),
        Field::bytes(&vec![1; super::LOG_ENVELOPE_BYTES]),
    );
    let doc = encode(Resource::Log, fields.clone()).unwrap();
    assert_eq!(decode(Resource::Log, &doc).unwrap(), fields);
    fields.insert(
        "envelope".into(),
        Field::bytes(&vec![1; super::LOG_ENVELOPE_BYTES + 1]),
    );
    assert!(encode(Resource::Log, fields.clone()).is_err());
    fields.insert("envelope".into(), Field::bytes(&[]));
    assert!(encode(Resource::Log, fields.clone()).is_err());
    // Only the canonical padded spelling is a bytesValue.
    fields.insert("envelope".into(), Field::Bytes("AQ".into()));
    assert!(encode(Resource::Log, fields).is_err());
}
#[test]
fn legacy_string_envelope_boundary_is_exact() {
    let mut fields = log();
    fields.insert("envelope".into(), string(&"e".repeat(354_304)));
    let doc = encode(Resource::Log, fields.clone()).unwrap();
    assert_eq!(decode(Resource::Log, &doc).unwrap(), fields);
    fields.insert("envelope".into(), string(&"e".repeat(354_305)));
    assert!(encode(Resource::Log, fields).is_err());
}
#[test]
fn discovery_and_interest_do_not_carry_a_stream_or_cursor() {
    let scope = page_scope(&"a".repeat(32), PAGE, 1).unwrap();
    assert_eq!(scope.len(), 3);
    assert_eq!(scope["epoch"], json!({"integerValue":"1"}));
    let authority = authority_scope(&"a".repeat(32), PAGE, 1, "membership", "").unwrap();
    assert_eq!(authority.len(), 5);
    assert_eq!(authority["recipient"], json!({"stringValue":""}));
    assert!(authority_scope(&"a".repeat(32), PAGE, 1, "wrap", "").is_err());
    assert!(authority_scope(&"a".repeat(32), PAGE, 1, "chain", "someone").is_err());
    assert_eq!(
        authority_scope(&"a".repeat(32), PAGE, 1, "wrap", "member").unwrap()["recipient"],
        json!({"stringValue":"member"})
    );
}

fn checkpoint() -> Fields {
    let mut fields = log();
    for key in ["stream", "hash", "envelope"] {
        fields.remove(key);
    }
    fields.insert("object".into(), string(&"c".repeat(64)));
    fields.insert("index".into(), Field::number(0).unwrap());
    fields.insert("count".into(), Field::number(2).unwrap());
    fields.insert(
        "bytes".into(),
        string(&values::encode_binary(&[11; 32_768])),
    );
    fields
}
#[test]
fn checkpoint_chunks_use_index_ids_but_positive_stream_sequences() {
    let fields = checkpoint();
    let doc = encode(Resource::Checkpoints, fields.clone()).unwrap();
    assert!(doc.target.id.ends_with("_0"));
    assert_eq!(doc.fields["seq"], json!({"integerValue":"1"}));
    assert_eq!(decode(Resource::Checkpoints, &doc).unwrap(), fields);
    for (key, n) in [("seq", 2), ("count", 0)] {
        let mut wrong = fields.clone();
        wrong.insert(key.into(), Field::number(n).unwrap());
        assert!(encode(Resource::Checkpoints, wrong).is_err());
    }
    let mut oversized = fields;
    oversized.insert(
        "bytes".into(),
        string(&values::encode_binary(&[11; 32_769])),
    );
    assert!(encode(Resource::Checkpoints, oversized).is_err());
}
#[test]
fn authority_ids_and_wrap_discovery_preserve_recipient_boundaries() {
    let mut fields = checkpoint();
    fields.remove("object");
    fields.remove("index");
    fields.insert("subject".into(), string(&"c".repeat(64)));
    fields.insert("kind".into(), string("membership"));
    fields.insert("recipient".into(), string(""));
    fields.insert("bytes".into(), string("eA"));
    let doc = encode(Resource::Authority, fields.clone()).unwrap();
    assert!(
        doc.target
            .id
            .ends_with(&format!("_membership_{}_1", "c".repeat(64)))
    );
    assert_eq!(decode(Resource::Authority, &doc).unwrap(), fields);
    fields.insert("kind".into(), string("wrap"));
    assert!(encode(Resource::Authority, fields.clone()).is_err());
    fields.insert("recipient".into(), string("member"));
    assert!(
        encode(Resource::Authority, fields.clone()).is_err(),
        "wrap has exactly one chunk"
    );
    fields.insert("count".into(), Field::number(1).unwrap());
    assert!(encode(Resource::Authority, fields.clone()).is_ok());
    // A wrap may be addressed to a link: `link:` and its ID, nothing looser.
    for (recipient, ok) in [
        (format!("link:{STREAM}"), true),
        ("link:".to_owned(), false),
        ("link:not-an-id".to_owned(), false),
        (
            "link:30000000-0000-4000-8000-0000000000AA".to_owned(),
            false,
        ),
        (format!("link: {STREAM}"), false),
        (format!("Link:{STREAM}"), false),
        (format!("link:{STREAM}:x"), false),
    ] {
        fields.insert("recipient".into(), string(&recipient));
        assert_eq!(
            encode(Resource::Authority, fields.clone()).is_ok(),
            ok,
            "{recipient}"
        );
    }
    fields.insert("kind".into(), string("chain"));
    fields.insert("recipient".into(), string(&format!("link:{STREAM}")));
    assert!(
        encode(Resource::Authority, fields).is_err(),
        "only wraps carry a recipient"
    );
}
#[test]
fn a_members_seq_is_the_constant_one() {
    let member = |seq: Option<u64>| {
        let mut fields = Fields::from_iter([
            ("space".into(), string(&"a".repeat(32))),
            ("page".into(), string(PAGE)),
            ("uid".into(), string("holder")),
            ("role".into(), string("viewer")),
            ("link".into(), string(STREAM)),
            ("token".into(), string(&"T".repeat(43))),
        ]);
        if let Some(seq) = seq {
            fields.insert("seq".into(), Field::number(seq).unwrap());
        }
        fields
    };
    assert!(encode(Resource::Members, member(Some(1))).is_ok());
    for seq in [None, Some(0), Some(2)] {
        assert!(encode(Resource::Members, member(seq)).is_err(), "{seq:?}");
    }
}
#[test]
fn admission_documents_keep_the_seven_field_member_shape() {
    let member = Fields::from_iter([
        ("space".into(), string(&"a".repeat(32))),
        ("page".into(), string(PAGE)),
        ("uid".into(), string("owner")),
        ("role".into(), string("editor")),
        ("link".into(), Field::Null(())),
        ("token".into(), Field::Null(())),
        ("seq".into(), Field::number(1).unwrap()),
    ]);
    let doc = encode(Resource::Members, member.clone()).unwrap();
    assert_eq!(doc.fields["link"], json!({"nullValue":null}));
    assert_eq!(decode(Resource::Members, &doc).unwrap(), member);
    let mut legacy = member.clone();
    legacy.remove("link");
    legacy.remove("token");
    assert!(encode(Resource::Members, legacy).is_err());
    let mut mixed = member.clone();
    mixed.insert("token".into(), string("token"));
    assert!(encode(Resource::Members, mixed).is_err());
    let mut invalid = doc;
    invalid.fields.insert(
        "role".into(),
        json!({"stringValue":"editor","booleanValue":true}),
    );
    assert!(decode(Resource::Members, &invalid).is_err());
}

fn sealed_original(kind: &str, plaintext: &[u8]) -> Vec<u8> {
    sealed_original_at(kind, "1", plaintext)
}
fn sealed_original_at(kind: &str, epoch: &str, plaintext: &[u8]) -> Vec<u8> {
    let context = tmt_colab_model::object::Context {
        space: "a".repeat(32),
        page: PAGE.into(),
        epoch: epoch.into(),
        kind: kind.into(),
        namespace: "content".into(),
        author_device: STREAM.into(),
        membership_revision: "1".into(),
        stream_seq: if kind == "html" { "0" } else { "1" }.into(),
        prev_hash: [0; 32],
    };
    tmt_colab_model::object::seal(
        &context,
        &[3; 32],
        &ed25519_dalek::SigningKey::from_bytes(&[5; 32]),
        plaintext,
    )
    .unwrap()
    .to_bytes()
    .unwrap()
}
#[test]
fn original_log_projection_preserves_bytes_but_cannot_substitute_scope_or_hash() {
    // The cloud carries v1 JSON (#5876 PR 2 moves it); the local original is its v2 form.
    let local = sealed_original("update", b"original update");
    let envelope = tmt_colab_model::object::Envelope::from_bytes(&local).unwrap();
    let mut bytes = envelope.to_json_v1().unwrap();
    bytes.push(b'\n');
    let mut fields = log();
    fields.insert(
        "envelope".into(),
        string(std::str::from_utf8(&bytes).unwrap()),
    );
    fields.insert(
        "hash".into(),
        string(&values::encode_binary(&envelope.hash().unwrap())),
    );
    let document = encode(Resource::Log, fields.clone()).unwrap();
    assert_eq!(originals::log(&document).unwrap().bytes, local);
    for (key, value) in [
        ("page", string("10000000-0000-4000-8000-000000000002")),
        ("stream", string("20000000-0000-4000-8000-000000000002")),
        ("epoch", Field::number(2).unwrap()),
        ("seq", Field::number(2).unwrap()),
        ("hash", string(&values::encode_binary(&[9; 32]))),
    ] {
        let mut changed = fields.clone();
        changed.insert(key.into(), value);
        let forged = encode(Resource::Log, changed).unwrap();
        assert!(originals::log(&forged).is_err(), "{key}");
    }
    // Transport syntax accepts a validly framed signature mutation. Admission
    // must still verify it, rather than treating this projection as authority.
    let mut wire: Value = serde_json::from_slice(&bytes).unwrap();
    wire["signature"] = json!(values::encode_binary(&[0; 64]));
    let forged_bytes = serde_json::to_vec(&wire).unwrap();
    let forged = tmt_colab_model::object::Envelope::from_json_v1(&forged_bytes).unwrap();
    fields.insert(
        "envelope".into(),
        string(std::str::from_utf8(&forged_bytes).unwrap()),
    );
    fields.insert(
        "hash".into(),
        string(&values::encode_binary(&forged.hash().unwrap())),
    );
    assert!(originals::log(&encode(Resource::Log, fields).unwrap()).is_ok());
}
#[test]
fn checkpoint_projection_requires_all_original_chunks_and_one_scope() {
    let bytes = sealed_original("checkpoint", &[17; 300_000]);
    let envelope = tmt_colab_model::object::Envelope::from_bytes(&bytes).unwrap();
    let header = tmt_colab_model::object::Header::decode(envelope.header()).unwrap();
    let mut fields = checkpoint();
    fields.insert("object".into(), string(&header.object_id));
    let documents = originals::checkpoint_documents(fields, &bytes).unwrap();
    assert!(documents.len() > 1);
    assert_eq!(originals::checkpoint(&documents).unwrap().bytes, bytes);
    assert!(originals::checkpoint(&documents[..documents.len() - 1]).is_err());
    let mut reversed = documents.clone();
    reversed.reverse();
    assert!(originals::checkpoint(&reversed).is_err());
    let mut duplicated = documents.clone();
    duplicated[1] = duplicated[0].clone();
    assert!(originals::checkpoint(&duplicated).is_err());
    let mut mixed = documents.clone();
    let mut fields = decode(Resource::Checkpoints, &mixed[1]).unwrap();
    fields.insert("uid".into(), string("other"));
    mixed[1] = encode(Resource::Checkpoints, fields).unwrap();
    assert!(originals::checkpoint(&mixed).is_err());
    let mut wrong = documents.clone();
    for document in &mut wrong {
        let mut fields = decode(Resource::Checkpoints, document).unwrap();
        fields.insert("object".into(), string(&"f".repeat(64)));
        *document = encode(Resource::Checkpoints, fields).unwrap();
    }
    assert!(originals::checkpoint(&wrong).is_err());
}

#[test]
fn timestamps_are_exact_whole_second_utc_spellings() {
    for (ms, text) in [
        (0, "1970-01-01T00:00:00Z"),
        (951_782_400_000, "2000-02-29T00:00:00Z"),
        (1_700_000_000_999, "2023-11-14T22:13:20Z"),
        (4_102_444_799_000, "2099-12-31T23:59:59Z"),
    ] {
        assert_eq!(Field::timestamp(ms).unwrap(), Field::Timestamp(text.into()));
    }
}

fn routing() -> originals::Routing<'static> {
    originals::Routing {
        space: Box::leak("a".repeat(32).into_boxed_str()),
        page: PAGE,
        epoch: 1,
        uid: "owner",
        expires_at: Field::timestamp(1_800_000_000_000).unwrap(),
    }
}
#[test]
fn a_stored_update_publishes_as_exactly_its_own_stream_sequence_hash_and_bytes() {
    let bytes = sealed_original("update", b"original update");
    let document = originals::log_document(&routing(), &bytes).unwrap();
    let parsed = originals::log(&document).unwrap();
    assert_eq!(parsed.bytes, bytes);
    assert_eq!(parsed.header.context.author_device, STREAM);
    let fields = decode(Resource::Log, &document).unwrap();
    assert_eq!(fields["uid"], string("owner"));
    assert_eq!(
        fields["expiresAt"],
        Field::Timestamp("2027-01-15T08:00:00Z".into())
    );
    // A checkpoint is not an update, and another page's update is not this page's.
    let checkpoint = sealed_original("checkpoint", b"cut");
    assert!(originals::log_document(&routing(), &checkpoint).is_err());
    let mut other = routing();
    other.epoch = 2;
    assert!(originals::log_document(&other, &bytes).is_err());
}
/// #5876's cloud budget: a 3 MB checkpoint is 12 bytesValue documents (123 base64url
/// stringValue chunks before), and its fields carry the raw bytes once plus REST base64.
#[test]
fn a_three_megabyte_checkpoint_is_twelve_documents() {
    let bytes = sealed_original("checkpoint", &vec![5; 3_000_000]);
    let base = originals::checkpoint_base(&routing(), &bytes).unwrap();
    let documents = originals::checkpoint_documents(base, &bytes).unwrap();
    assert_eq!(documents.len(), 12);
    let wire: usize = documents
        .iter()
        .map(|document| serde_json::to_vec(&document.fields).unwrap().len())
        .sum();
    assert!(wire < bytes.len() * 4 / 3 + 12 * 1024, "{wire}");
    assert_eq!(originals::checkpoint(&documents).unwrap().bytes, bytes);
}
/// A row written before #5876 PR 2 still reads: v1 JSON in 32 KiB base64url string chunks, or a
/// v1 JSON log envelope, each converted to the same v2 original under the same hash.
#[test]
fn legacy_v1_rows_read_back_as_the_v2_original() {
    let bytes = sealed_original("checkpoint", &[3; 50_000]);
    let envelope = tmt_colab_model::object::Envelope::from_bytes(&bytes).unwrap();
    let json = envelope.to_json_v1().unwrap();
    let mut fields = originals::checkpoint_base(&routing(), &bytes).unwrap();
    let count = json.len().div_ceil(super::LEGACY_CHUNK_BYTES);
    fields.insert("count".into(), Field::number(count as u64).unwrap());
    let legacy: Vec<_> = json
        .chunks(super::LEGACY_CHUNK_BYTES)
        .enumerate()
        .map(|(index, chunk)| {
            let mut row = fields.clone();
            row.insert("index".into(), Field::number(index as u64).unwrap());
            row.insert("seq".into(), Field::number(index as u64 + 1).unwrap());
            row.insert("bytes".into(), string(&values::encode_binary(chunk)));
            encode(Resource::Checkpoints, row).unwrap()
        })
        .collect();
    assert!(legacy.len() > 1);
    let read = originals::checkpoint(&legacy).unwrap();
    assert_eq!(read.bytes, bytes);
    assert_eq!(read.hash, envelope.hash().unwrap());
    // One object never mixes the two forms.
    let mut mixed = legacy.clone();
    let mut row = decode(Resource::Checkpoints, &mixed[1]).unwrap();
    let chunk = values::binary(row["bytes"].text().unwrap(), super::LEGACY_CHUNK_BYTES).unwrap();
    row.insert("bytes".into(), Field::bytes(&chunk));
    mixed[1] = encode(Resource::Checkpoints, row).unwrap();
    assert!(originals::checkpoint(&mixed).is_err());
    // A legacy row may not claim the v2 chunk count, nor a v2 row the legacy one.
    let mut row = decode(Resource::Checkpoints, &legacy[0]).unwrap();
    row.insert("count".into(), Field::number(514).unwrap());
    assert!(encode(Resource::Checkpoints, row).is_err());
    let mut row = decode(Resource::Checkpoints, &legacy[0]).unwrap();
    row.insert("bytes".into(), Field::bytes(&[1; 10]));
    row.insert("count".into(), Field::number(66).unwrap());
    assert!(encode(Resource::Checkpoints, row).is_err());
}
#[test]
fn a_v2_log_row_carries_the_original_bytes() {
    let local = sealed_original("update", b"original update");
    let document = originals::log_document(&routing(), &local).unwrap();
    assert_eq!(
        document.fields["envelope"],
        json!({"bytesValue": base64::engine::general_purpose::STANDARD.encode(&local)})
    );
    assert_eq!(originals::log(&document).unwrap().bytes, local);
    let mut forged = local.clone();
    *forged.last_mut().unwrap() ^= 1;
    let mut fields = decode(Resource::Log, &document).unwrap();
    fields.insert("envelope".into(), Field::bytes(&forged));
    let changed = encode(Resource::Log, fields).unwrap();
    assert!(originals::log(&changed).is_err(), "the hash binds the bytes");
}
#[test]
fn a_page_row_declares_the_object_format() {
    let mut fields = Fields::from_iter([
        ("space".into(), string(&"a".repeat(32))),
        ("page".into(), string(PAGE)),
        ("epoch".into(), Field::number(1).unwrap()),
        ("state".into(), string("open")),
        ("objectFormat".into(), Field::number(2).unwrap()),
        (
            "expiresAt".into(),
            Field::Timestamp("2026-10-15T00:00:00Z".into()),
        ),
    ]);
    assert!(encode(Resource::Pages, fields.clone()).is_ok());
    fields.insert("objectFormat".into(), Field::number(1).unwrap());
    assert!(encode(Resource::Pages, fields.clone()).is_err());
    fields.remove("objectFormat");
    assert!(encode(Resource::Pages, fields).is_err());
}
#[test]
fn a_checkpoint_publishes_through_the_shared_base_and_reads_back_whole() {
    let bytes = sealed_original("checkpoint", &[9; 600_000]);
    let base = originals::checkpoint_base(&routing(), &bytes).unwrap();
    let documents = originals::checkpoint_documents(base, &bytes).unwrap();
    assert_eq!(documents.len(), 3);
    assert_eq!(originals::checkpoint(&documents).unwrap().bytes, bytes);
}
fn routing_at(epoch: u64) -> originals::Routing<'static> {
    originals::Routing { epoch, ..routing() }
}
#[test]
fn a_baseline_publishes_as_chunks_under_its_own_hash_and_reads_back_whole() {
    let bytes = sealed_original_at("html", "2", &[7; 600_000]);
    let hash = tmt_extension_objects::Sha256Hex::from_bytes(
        tmt_colab_model::object::Envelope::from_bytes(&bytes)
            .unwrap()
            .hash()
            .unwrap(),
    )
    .to_string();
    let documents = originals::baseline_documents(&routing_at(2), &bytes).unwrap();
    assert!(documents.len() > 2, "chunked like any checkpoint object");
    for (index, document) in documents.iter().enumerate() {
        let fields = decode(Resource::Checkpoints, document).unwrap();
        assert_eq!(fields["object"], string(&hash), "the object ID is the hash");
        assert_eq!(fields["epoch"], Field::number(2).unwrap());
        assert_eq!(fields["index"], Field::number(index as u64).unwrap());
    }
    let read = originals::baseline(&documents).unwrap();
    assert_eq!(read.bytes, bytes);
    // Partial, reordered or doctored sets are not a baseline.
    assert!(originals::baseline(&documents[1..]).is_err());
    let mut reordered = documents.clone();
    reordered.swap(0, 1);
    assert!(originals::baseline(&reordered).is_err());
    // A checkpoint reassembles only as a checkpoint, and a baseline only as a baseline.
    assert!(originals::checkpoint(&documents).is_err());
    let checkpoint = sealed_original_at("checkpoint", "2", &[7; 70_000]);
    let base = originals::checkpoint_base(&routing_at(2), &checkpoint).unwrap();
    let chunks = originals::checkpoint_documents(base, &checkpoint).unwrap();
    assert!(originals::baseline(&chunks).is_err());
}
#[test]
fn a_baseline_is_refused_for_the_wrong_epoch_kind_or_scope() {
    let bytes = sealed_original_at("html", "2", b"baseline");
    assert!(originals::baseline_documents(&routing_at(2), &bytes).is_ok());
    assert!(
        originals::baseline_documents(&routing_at(3), &bytes).is_err(),
        "another epoch's"
    );
    assert!(
        originals::baseline_documents(&routing(), &sealed_original_at("html", "1", b"first"))
            .is_err(),
        "the first epoch has no baseline"
    );
    assert!(
        originals::baseline_documents(&routing_at(2), &sealed_original_at("update", "2", b"x"))
            .is_err(),
        "an update is not a baseline"
    );
    let mut other = routing_at(2);
    other.page = "10000000-0000-4000-8000-0000000000ff";
    assert!(originals::baseline_documents(&other, &bytes).is_err());
    assert!(originals::baseline_documents(&routing_at(2), b"").is_err());
}
#[test]
fn signed_authority_splits_and_reassembles_exactly_and_refuses_anything_partial() {
    let statement: Vec<u8> = (0..70_000u32).map(|n| (n % 251) as u8).collect();
    let documents = originals::authority_documents(
        &routing(),
        originals::Authority::Membership,
        "",
        &statement,
    )
    .unwrap();
    assert_eq!(documents.len(), 3);
    assert!(documents[0].target.id.contains("_1_membership_"));
    let (kind, bytes) = originals::authority(&documents).unwrap();
    assert_eq!(
        (kind, bytes),
        (originals::Authority::Membership, statement.clone())
    );
    assert!(originals::authority(&documents[..2]).is_err(), "partial");
    let mut reversed = documents.clone();
    reversed.reverse();
    assert!(originals::authority(&reversed).is_err(), "reordered");
    let mut tampered = documents.clone();
    let mut fields = decode(Resource::Authority, &tampered[2]).unwrap();
    fields.insert("bytes".into(), string(&values::encode_binary(&[1, 2, 3])));
    tampered[2] = encode(Resource::Authority, fields).unwrap();
    assert!(
        originals::authority(&tampered).is_err(),
        "bytes that do not hash to the subject"
    );
    // A chain or wrap is exactly one piece, and a wrap names the reading uid.
    assert!(
        originals::authority_documents(&routing(), originals::Authority::Chain, "", &statement)
            .is_err()
    );
    let wrap = originals::authority_documents(
        &routing(),
        originals::Authority::Wrap,
        "reader",
        b"{\"wrap\":1}",
    )
    .unwrap();
    assert_eq!(
        decode(Resource::Authority, &wrap[0]).unwrap()["recipient"],
        string("reader")
    );
    assert!(
        originals::authority_documents(&routing(), originals::Authority::Wrap, "", b"x").is_err()
    );
    assert!(
        originals::authority_documents(&routing(), originals::Authority::Chain, "", b"").is_err()
    );
}

#[test]
fn frozen_cloud_fold_delivery_preserves_log_anchors_and_chunked_fold_originals() {
    let v: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../contracts/vectors/fold-v1.json"
    ))
    .unwrap();
    let route = originals::Routing {
        space: v["spaceId"].as_str().unwrap(),
        page: v["pageId"].as_str().unwrap(),
        epoch: 1,
        uid: "owner",
        expires_at: Field::timestamp(1_790_000_000_000).unwrap(),
    };
    for case in v["cloudCases"].as_array().unwrap() {
        let frames = v["cases"][case["case"].as_u64().unwrap() as usize]["frames"]
            .as_array()
            .unwrap();
        for frame in frames {
            let (entry, anchor) = if let Some(anchor) = frame.get("anchor") {
                (anchor, true)
            } else {
                (&frame["checkpoint"], false)
            };
            let cloud =
                tmt_colab_model::values::binary(entry["envelope"].as_str().unwrap(), 354304)
                    .unwrap();
            let bytes = tmt_colab_model::object::Envelope::from_json_v1(&cloud)
                .unwrap()
                .to_bytes()
                .unwrap();
            if anchor {
                let document = originals::log_document(&route, &bytes).unwrap();
                assert_eq!(originals::log(&document).unwrap().bytes, bytes);
            } else {
                let base = originals::checkpoint_base(&route, &bytes).unwrap();
                let chunks = originals::checkpoint_documents(base, &bytes).unwrap();
                let original = originals::checkpoint(&chunks).unwrap();
                assert_eq!(original.bytes, bytes);
                assert_eq!(original.header.context.kind, "fold");
                assert_eq!(
                    original.header.covered_device.as_deref(),
                    frame["streamId"].as_str()
                );
            }
        }
    }
}
