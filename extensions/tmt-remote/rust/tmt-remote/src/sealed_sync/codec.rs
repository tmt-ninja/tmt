//! Restricted REST Document.fields codec. No provider call, timestamp rounding or coercion.
use super::{Document, Query, SyncContext, SyncError};
use crate::deploy_plan::sha256_hex;
use serde_json::{Map, Value};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentAccess {
    Read,
    Publish,
}
const SAFE: u64 = (1u64 << 53) - 1;
fn invalid<T>() -> Result<T, SyncError> {
    Err(SyncError::Invalid)
}
/// Exact canonical bytes and declared fields; visible metadata is not a second outer envelope.
pub fn validate_document(
    context: &SyncContext,
    document: &Document,
    access: DocumentAccess,
) -> Result<(), SyncError> {
    context.document_path(&document.target)?;
    let resource = context
        .resources
        .iter()
        .find(|r| r.name == document.target.resource)
        .ok_or(SyncError::Invalid)?;
    let mapping = resource.sync.as_ref().ok_or(SyncError::Unavailable)?;
    if document.bytes.len() as u64 > resource.bounds.max_object_bytes
        || sha256_hex(&document.bytes) != document.digest
    {
        return invalid();
    }
    let row = context.validate_fields(&document.bytes)?;
    if row.len() != mapping.fields.len()
        || !mapping
            .fields
            .iter()
            .all(|key| row.get(key).is_some_and(|v| context.codec.field(v)))
    {
        return invalid();
    }
    if let Some(query) = &mapping.query {
        let stream = context.codec.string(&row[&query.stream_field]);
        let seq = context.codec.sequence(&row[&query.seq_field]);
        if !stream.is_some_and(|s| super::id(s, 128)) || seq.is_none_or(|n| n == 0) {
            return invalid();
        }
    }
    if !context
        .codec
        .text_is(row.get(&mapping.space_field), &context.space)
    {
        return Err(SyncError::Denied);
    }
    if access == DocumentAccess::Publish
        && mapping
            .uid_field
            .as_ref()
            .is_some_and(|key| !context.codec.text_is(row.get(key), &context.identity.uid))
    {
        return Err(SyncError::Denied);
    }
    Ok(())
}
/// Exact scope filters and logical contiguous cursor, not an arbitrary REST structured query.
pub fn validate_query(context: &SyncContext, query: &Query) -> Result<(), SyncError> {
    let resource = context
        .resources
        .iter()
        .find(|r| r.name == query.resource)
        .ok_or(SyncError::Invalid)?;
    let mapping = resource.sync.as_ref().ok_or(SyncError::Unavailable)?;
    let spec = mapping.query.as_ref().ok_or(SyncError::Unavailable)?;
    if query.scope.len() != spec.scope_fields.len()
        || !spec
            .scope_fields
            .iter()
            .all(|key| query.scope.get(key).is_some_and(|v| context.codec.field(v)))
        || !super::id(&query.stream, 128)
    {
        return invalid();
    }
    if !context
        .codec
        .text_is(query.scope.get(&mapping.space_field), &context.space)
        || !context
            .codec
            .text_is(query.scope.get(&spec.stream_field), &query.stream)
    {
        return Err(SyncError::Denied);
    }
    if query
        .cursor
        .as_ref()
        .is_some_and(|cursor| cursor.stream != query.stream || cursor.seq > SAFE)
    {
        return invalid();
    }
    Ok(())
}
/// Validate standalone codec vectors through the selected production adapter.
pub fn validate_fields(bytes: &[u8]) -> Result<Map<String, Value>, SyncError> {
    crate::cloud_provider::default_fields(bytes)
}

/// One declared page-scope discovery shape; no logical cursor or stream wildcard on normal queries.
pub fn validate_discovery(
    context: &SyncContext,
    query: &super::DiscoveryQuery,
) -> Result<(), SyncError> {
    let resource = context
        .resources
        .iter()
        .find(|r| r.name == query.resource)
        .ok_or(SyncError::Invalid)?;
    let mapping = resource.sync.as_ref().ok_or(SyncError::Unavailable)?;
    let discovery = mapping
        .query
        .as_ref()
        .and_then(|q| q.discovery.as_ref())
        .ok_or(SyncError::Unsupported)?;
    if query.shape != discovery.name
        || query.continuation.as_ref().is_some_and(|c| {
            c.0.is_empty() || c.0.len() > 1024 || !c.0.bytes().all(|b| (0x21..=0x7e).contains(&b))
        })
        || query.scope.len() != discovery.scope_fields.len()
        || !discovery
            .scope_fields
            .iter()
            .all(|key| query.scope.get(key).is_some_and(|v| context.codec.field(v)))
    {
        return invalid();
    }
    if !context
        .codec
        .text_is(query.scope.get(&mapping.space_field), &context.space)
    {
        return Err(SyncError::Denied);
    }
    // The transport adds only the declaration's optional seq equality, never caller-supplied filters.
    Ok(())
}
/// Declared modes never grant authority; ordinary Auth and Colab Rules remain decisive.
pub fn validate_mutation(
    context: &SyncContext,
    mutation: &super::Mutation,
) -> Result<(), SyncError> {
    let (mode, target) = match mutation {
        super::Mutation::Create(doc) => ("create", &doc.target),
        super::Mutation::Put(doc) => ("put", &doc.target),
        super::Mutation::Delete(target) => ("delete", target),
    };
    context.document_path(target)?;
    let mapping = context
        .resources
        .iter()
        .find(|r| r.name == target.resource)
        .and_then(|r| r.sync.as_ref())
        .ok_or(SyncError::Unsupported)?;
    if !mapping
        .write_modes
        .as_ref()
        .map_or(mode == "create", |modes| modes.iter().any(|m| m == mode))
    {
        return Err(SyncError::Unsupported);
    }
    match mutation {
        super::Mutation::Create(doc) | super::Mutation::Put(doc) => {
            validate_document(context, doc, DocumentAccess::Publish)
        }
        super::Mutation::Delete(_) => Ok(()),
    }
}

/// Exact page scope without the stream predicate; discovery declaration is not required.
pub fn validate_interest(
    context: &SyncContext,
    interest: &super::SyncInterest,
) -> Result<(), SyncError> {
    let resource = context
        .resources
        .iter()
        .find(|r| r.name == interest.resource)
        .ok_or(SyncError::Invalid)?;
    let mapping = resource.sync.as_ref().ok_or(SyncError::Unavailable)?;
    let query = mapping.query.as_ref().ok_or(SyncError::Unavailable)?;
    let fields: Vec<_> = query
        .scope_fields
        .iter()
        .filter(|key| **key != query.stream_field)
        .collect();
    if interest.scope.len() != fields.len()
        || !fields.iter().all(|key| {
            interest
                .scope
                .get(*key)
                .is_some_and(|v| context.codec.field(v))
        })
    {
        return invalid();
    }
    if !context
        .codec
        .text_is(interest.scope.get(&mapping.space_field), &context.space)
    {
        return Err(SyncError::Denied);
    }
    Ok(())
}
