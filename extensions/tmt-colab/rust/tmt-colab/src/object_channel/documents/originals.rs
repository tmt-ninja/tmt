//! Exact original bytes behind the declared transport projection. Syntax and
//! scope checks here never replace certificate, membership or epoch admission.
use super::{
    CHUNK_BYTES, Field, Fields, Invalid, LEGACY_CHUNK_BYTES, LOG_ENVELOPE_BYTES, MAX_CHUNKS,
    Resource, binary, decode, encode, integer, text,
};
use tmt_colab_model::{crypto, object, values};
use tmt_extension_objects::{Sha256Hex, sync};

/// A parsed original still needs the existing Colab signature/admission verifier.
pub struct Original {
    pub bytes: Vec<u8>,
    pub header: object::Header,
    pub hash: [u8; 32],
}
/// How a row carries its original: v2 bytes, or the v1 JSON a row written before #5876 PR 2
/// holds. A legacy row is converted under the same hash, as the store converter does.
enum Cloud {
    Bytes(Vec<u8>),
    Legacy(Vec<u8>),
}
/// A cloud original, returned as the local v2 bytes.
fn original(cloud: Cloud, fields: &Fields, kinds: &[&str]) -> Result<Original, Invalid> {
    let (envelope, bytes) = match cloud {
        Cloud::Bytes(bytes) => (
            object::Envelope::from_bytes(&bytes).map_err(|_| Invalid)?,
            bytes,
        ),
        Cloud::Legacy(json) => {
            let envelope = object::Envelope::from_json_v1(&json).map_err(|_| Invalid)?;
            let bytes = envelope.to_bytes().map_err(|_| Invalid)?;
            (envelope, bytes)
        }
    };
    let header = object::Header::decode(envelope.header()).map_err(|_| Invalid)?;
    let context = &header.context;
    if context.space != text(fields, "space")?
        || context.page != text(fields, "page")?
        || context.epoch != integer(fields, "epoch")?.to_string()
        || !kinds.contains(&context.kind.as_str())
    {
        return Err(Invalid);
    }
    let hash = envelope.hash().map_err(|_| Invalid)?;
    Ok(Original {
        bytes,
        header,
        hash,
    })
}
/// Compare unsigned routing fields with the sealed header/hash before admission.
/// The returned bytes are the local v2 form of the original received.
pub fn log(document: &sync::Document) -> Result<Original, Invalid> {
    let fields = decode(Resource::Log, document)?;
    let cloud = match fields.get("envelope") {
        Some(Field::String(legacy)) => Cloud::Legacy(legacy.as_bytes().to_vec()),
        _ => Cloud::Bytes(binary(&fields, "envelope", LOG_ENVELOPE_BYTES)?),
    };
    let result = original(cloud, &fields, &["update"])?;
    if result.header.context.author_device != text(&fields, "stream")?
        || result.header.context.stream_seq != integer(&fields, "seq")?.to_string()
        || values::binary(text(&fields, "hash")?, 32).map_err(|_| Invalid)? != result.hash
    {
        return Err(Invalid);
    }
    Ok(result)
}
/// Split one already sealed checkpoint. No new seal, identity or payload store.
pub fn checkpoint_documents(fields: Fields, bytes: &[u8]) -> Result<Vec<sync::Document>, Invalid> {
    let parsed = original(
        Cloud::Bytes(bytes.to_vec()),
        &fields,
        &["checkpoint", object::FOLD],
    )?;
    if parsed.header.object_id != text(&fields, "object")? || bytes.is_empty() {
        return Err(Invalid);
    }
    chunk_documents(fields, bytes)
}
/// The chunk records of one exact object, each a whole-field create under the same routing.
fn chunk_documents(mut fields: Fields, bytes: &[u8]) -> Result<Vec<sync::Document>, Invalid> {
    let count = bytes.len().div_ceil(CHUNK_BYTES);
    if count > MAX_CHUNKS {
        return Err(Invalid);
    }
    fields.insert("count".into(), Field::number(count as u64)?);
    bytes
        .chunks(CHUNK_BYTES)
        .enumerate()
        .map(|(index, chunk)| {
            let mut row = fields.clone();
            row.insert("index".into(), Field::number(index as u64)?);
            row.insert("seq".into(), Field::number(index as u64 + 1)?);
            row.insert("bytes".into(), Field::bytes(chunk));
            encode(Resource::Checkpoints, row)
        })
        .collect()
}
/// A complete ordered object query is required. Partial, duplicate, mixed or
/// reordered chunks cannot become a checkpoint or advance a verified position.
pub fn checkpoint(documents: &[sync::Document]) -> Result<Original, Invalid> {
    let (first, bytes) = chunks(documents)?;
    let result = original(bytes, &first, &["checkpoint", object::FOLD])?;
    if result.header.object_id != text(&first, "object")? {
        return Err(Invalid);
    }
    Ok(result)
}
/// The ordered, complete chunks of one object, reassembled, with the first chunk's routing.
/// Every chunk of one object has the first chunk's form; a legacy object is v1 JSON.
fn chunks(documents: &[sync::Document]) -> Result<(Fields, Cloud), Invalid> {
    let first = decode(Resource::Checkpoints, documents.first().ok_or(Invalid)?)?;
    let legacy = matches!(first.get("bytes"), Some(Field::String(_)));
    let size = if legacy {
        LEGACY_CHUNK_BYTES
    } else {
        CHUNK_BYTES
    };
    let count = integer(&first, "count")?;
    if count == 0 || count != documents.len() as u64 {
        return Err(Invalid);
    }
    let mut bytes = Vec::new();
    for (index, document) in documents.iter().enumerate() {
        let fields = decode(Resource::Checkpoints, document)?;
        for key in ["space", "page", "epoch", "object", "count", "uid"] {
            if fields.get(key) != first.get(key) {
                return Err(Invalid);
            }
        }
        if integer(&fields, "index")? != index as u64 {
            return Err(Invalid);
        }
        let chunk = if legacy {
            values::binary(text(&fields, "bytes")?, size).map_err(|_| Invalid)?
        } else {
            binary(&fields, "bytes", size)?
        };
        // Only the final chunk may be short; the producer's partition is fixed.
        if index + 1 < documents.len() && chunk.len() != size {
            return Err(Invalid);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((
        first,
        if legacy {
            Cloud::Legacy(bytes)
        } else {
            Cloud::Bytes(bytes)
        },
    ))
}
/// The records that carry an epoch's baseline: the exact sealed `html` original the owner Store
/// holds, in the checkpoints carrier, under its own hash. `object` is the lowercase hex of the
/// hash the signed `epoch.advance` names, so a reader finds it from the verified membership log.
pub fn baseline_documents(
    routing: &Routing<'_>,
    bytes: &[u8],
) -> Result<Vec<sync::Document>, Invalid> {
    let envelope = object::Envelope::from_bytes(bytes).map_err(|_| Invalid)?;
    let header = object::Header::decode(envelope.header()).map_err(|_| Invalid)?;
    let context = &header.context;
    if routing.epoch < 2
        || context.space != routing.space
        || context.page != routing.page
        || context.epoch != routing.epoch.to_string()
        || context.kind != "html"
        || bytes.is_empty()
    {
        return Err(Invalid);
    }
    let hash = Sha256Hex::from_bytes(envelope.hash().map_err(|_| Invalid)?).to_string();
    let mut fields = routing.base()?;
    fields.insert("object".into(), Field::String(hash));
    chunk_documents(fields, bytes)
}
/// A complete baseline, reassembled: every chunk present and in order, and the sealed original
/// hashing to the object ID it was published under. Verifying it is the reader's job.
pub fn baseline(documents: &[sync::Document]) -> Result<Original, Invalid> {
    let (first, bytes) = chunks(documents)?;
    let result = original(bytes, &first, &["html"])?;
    if Sha256Hex::from_bytes(result.hash).to_string() != text(&first, "object")?
        || integer(&first, "epoch")? < 2
    {
        return Err(Invalid);
    }
    Ok(result)
}

/// Routing facts the publisher stamps on every record of one page and epoch. They are
/// transport integrity, never authority: consumers verify the signed bytes themselves.
pub struct Routing<'a> {
    pub space: &'a str,
    pub page: &'a str,
    pub epoch: u64,
    /// The writer's Firebase uid, which Rules bind to the record.
    pub uid: &'a str,
    pub expires_at: Field,
}
impl Routing<'_> {
    fn base(&self) -> Result<Fields, Invalid> {
        Ok(Fields::from_iter([
            ("space".into(), Field::String(self.space.into())),
            ("page".into(), Field::String(self.page.into())),
            ("epoch".into(), Field::number(self.epoch)?),
            ("uid".into(), Field::String(self.uid.into())),
            ("expiresAt".into(), self.expires_at.clone()),
        ]))
    }
}
/// The record that carries one stored update, byte for byte. The stream and sequence come from
/// the signed header, so an update can only be published under its own identity.
pub fn log_document(routing: &Routing<'_>, bytes: &[u8]) -> Result<sync::Document, Invalid> {
    let envelope = object::Envelope::from_bytes(bytes).map_err(|_| Invalid)?;
    let header = object::Header::decode(envelope.header()).map_err(|_| Invalid)?;
    let context = &header.context;
    if context.space != routing.space
        || context.page != routing.page
        || context.epoch != routing.epoch.to_string()
        || context.kind != "update"
    {
        return Err(Invalid);
    }
    let mut fields = routing.base()?;
    fields.insert(
        "stream".into(),
        Field::String(context.author_device.clone()),
    );
    fields.insert(
        "seq".into(),
        Field::number(values::decimal(&context.stream_seq, false).map_err(|_| Invalid)?)?,
    );
    fields.insert(
        "hash".into(),
        Field::String(values::encode_binary(
            &envelope.hash().map_err(|_| Invalid)?,
        )),
    );
    if bytes.len() > LOG_ENVELOPE_BYTES {
        return Err(Invalid);
    }
    fields.insert("envelope".into(), Field::bytes(bytes));
    encode(Resource::Log, fields)
}
/// The create-only records of one paired checkpoint original: its fields without the chunk
/// facts, which `checkpoint_documents` adds.
pub fn checkpoint_base(routing: &Routing<'_>, bytes: &[u8]) -> Result<Fields, Invalid> {
    let envelope = object::Envelope::from_bytes(bytes).map_err(|_| Invalid)?;
    let header = object::Header::decode(envelope.header()).map_err(|_| Invalid)?;
    let mut fields = routing.base()?;
    fields.insert("object".into(), Field::String(header.object_id));
    Ok(fields)
}
/// The kinds of signed authority, each stored as the exact original bytes of one statement,
/// chain or wrap.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Authority {
    Membership,
    Chain,
    Wrap,
}
impl Authority {
    fn name(self) -> &'static str {
        match self {
            Self::Membership => "membership",
            Self::Chain => "chain",
            Self::Wrap => "wrap",
        }
    }
    fn pieces(self) -> usize {
        if self == Self::Membership { 11 } else { 1 }
    }
}
/// Split one exact signed original into its authority records: the subject is the lowercase
/// SHA-256 of the whole original, pieces are at most 32 KiB, and `recipient` is empty except
/// for a wrap, which names the reading uid.
pub fn authority_documents(
    routing: &Routing<'_>,
    kind: Authority,
    recipient: &str,
    bytes: &[u8],
) -> Result<Vec<sync::Document>, Invalid> {
    let count = bytes.len().div_ceil(32_768);
    if bytes.is_empty() || count > kind.pieces() {
        return Err(Invalid);
    }
    let subject = Sha256Hex::from_bytes(crypto::digest(bytes)).to_string();
    bytes
        .chunks(32_768)
        .enumerate()
        .map(|(index, piece)| {
            let mut fields = routing.base()?;
            fields.insert("kind".into(), Field::String(kind.name().into()));
            fields.insert("subject".into(), Field::String(subject.clone()));
            fields.insert("seq".into(), Field::number(index as u64 + 1)?);
            fields.insert("count".into(), Field::number(count as u64)?);
            fields.insert("recipient".into(), Field::String(recipient.into()));
            fields.insert("bytes".into(), Field::String(values::encode_binary(piece)));
            encode(Resource::Authority, fields)
        })
        .collect()
}
/// A complete ordered set of one subject's records, reassembled. Partial, duplicate, mixed or
/// reordered pieces, or bytes that do not hash to the subject, are refused.
pub fn authority(documents: &[sync::Document]) -> Result<(Authority, Vec<u8>), Invalid> {
    let first = decode(Resource::Authority, documents.first().ok_or(Invalid)?)?;
    let kind = match text(&first, "kind")? {
        "membership" => Authority::Membership,
        "chain" => Authority::Chain,
        "wrap" => Authority::Wrap,
        _ => return Err(Invalid),
    };
    let count = integer(&first, "count")?;
    if count == 0 || count as usize > kind.pieces() || count != documents.len() as u64 {
        return Err(Invalid);
    }
    let mut bytes = Vec::new();
    for (index, document) in documents.iter().enumerate() {
        let fields = decode(Resource::Authority, document)?;
        for key in [
            "space",
            "page",
            "epoch",
            "kind",
            "subject",
            "count",
            "uid",
            "recipient",
        ] {
            if fields.get(key) != first.get(key) {
                return Err(Invalid);
            }
        }
        if integer(&fields, "seq")? != index as u64 + 1 {
            return Err(Invalid);
        }
        let piece = values::binary(text(&fields, "bytes")?, 32_768).map_err(|_| Invalid)?;
        if index + 1 < documents.len() && piece.len() != 32_768 {
            return Err(Invalid);
        }
        bytes.extend_from_slice(&piece);
    }
    if Sha256Hex::from_bytes(crypto::digest(&bytes)).to_string() != text(&first, "subject")? {
        return Err(Invalid);
    }
    Ok((kind, bytes))
}
