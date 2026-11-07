//! The one entry point for a structured page's blocks (#6004). The browser's save path (a sync
//! job) and `tmt colab block` both build their action here and publish it through the same
//! structured publisher, the same validator (`blocks::ops::apply`), the same receipt and the same
//! history entry. A batch carries no revision to match: its ops address blocks by id and merge into
//! whatever the page holds now.
use super::{
    PublicationPreparation, StructuredAction,
    save::{Prepared, SourceOpener},
};
use crate::{decoder::StructuredKind, limits};
use serde_json::{Value, json};

/// The action name the decoder's structured edit carries.
pub const ACTION: &str = "blocks.batch";

pub struct BlockBatch {
    pub page: String,
    pub operation_id: String,
    pub ops: Value,
}

/// The cheap shape check before a source is opened; the validator checks every op's content.
pub fn validate(ops: &Value) -> crate::Result<()> {
    let ok = ops
        .as_array()
        .is_some_and(|ops| !ops.is_empty() && ops.len() <= limits::BLOCK_BATCH_OPS)
        && serde_json::to_vec(ops).is_ok_and(|bytes| bytes.len() <= limits::BLOCK_BATCH_BYTES);
    if ok {
        Ok(())
    } else {
        Err(super::Fault::Capacity.into())
    }
}

pub fn body(ops: &Value) -> Value {
    json!({ "ops": ops })
}

/// The structured action for a batch. `display_agent` is the caller's display-only label.
pub fn action<'a>(
    body: &'a Value,
    display_agent: Option<Value>,
    operation_id: Option<&'a str>,
) -> StructuredAction<'a> {
    StructuredAction {
        kind: StructuredKind::Blocks,
        action: ACTION,
        body,
        expected_revision: None,
        display_agent,
        operation_id,
    }
}

/// What a prepared batch is: a publication to commit (or nothing to commit) and its receipt.
pub struct Batch {
    pub prepared: PublicationPreparation,
    pub receipt: Value,
}

/// Prepare against an opened page, outside every lock.
pub fn prepare_open(
    source: &mut super::save::Source,
    page: &str,
    ops: &Value,
    display_agent: Option<Value>,
    operation_id: Option<&str>,
    clock: &dyn Fn() -> crate::Result<u64>,
) -> crate::Result<Batch> {
    validate(ops)?;
    let body = body(ops);
    let (prepared, receipt) = super::prepare_blocks_publication(
        &source.store,
        &source.keyring,
        page,
        action(&body, display_agent, operation_id),
        &mut source.decoder,
        clock,
    )?;
    Ok(Batch { prepared, receipt })
}

/// The browser's batch: prepared from a source the serve opens, framed as a save result.
pub fn prepare(
    open: &SourceOpener,
    batch: &BlockBatch,
    clock: &dyn Fn() -> crate::Result<u64>,
) -> crate::Result<(Prepared, Value)> {
    let mut source = open()?;
    let done = prepare_open(
        &mut source,
        &batch.page,
        &batch.ops,
        None,
        Some(&batch.operation_id),
        clock,
    )?;
    let prepared =
        super::save::structured(&source, &batch.page, &batch.operation_id, done.prepared)?;
    Ok((prepared, done.receipt))
}
