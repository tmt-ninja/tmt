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
use tmt_colab_model::attachment::DocumentChange;

/// The action name the decoder's structured edit carries.
pub const ACTION: &str = "blocks.batch";

pub struct BlockBatch {
    pub page: String,
    pub operation_id: String,
    pub ops: Value,
    /// A typed change to the page's attachment list (#6190), judged with the ops.
    pub attachments: Option<DocumentChange>,
}

/// The cheap shape check before a source is opened; the validator checks every op's content. A
/// batch may have no ops only when it carries an attachment change (attach or detach alone).
pub fn validate(ops: &Value, attachments: Option<&DocumentChange>) -> crate::Result<()> {
    let changes = attachments.is_some_and(|change| !change.is_empty());
    let ok = ops
        .as_array()
        .is_some_and(|ops| (!ops.is_empty() || changes) && ops.len() <= limits::BLOCK_BATCH_OPS)
        && serde_json::to_vec(ops).is_ok_and(|bytes| bytes.len() <= limits::BLOCK_BATCH_BYTES);
    if ok {
        Ok(())
    } else {
        Err(super::Fault::Capacity.into())
    }
}

pub fn body(ops: &Value, attachments: Option<&DocumentChange>) -> Value {
    let mut body = json!({ "ops": ops });
    if let Some(change) = attachments.filter(|change| !change.is_empty()) {
        body["attachments"] = serde_json::to_value(change).expect("typed attachment change");
    }
    body
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
pub struct Edited {
    pub prepared: PublicationPreparation,
    pub receipt: Value,
}

/// Prepare against an opened page, outside every lock.
pub fn prepare_open(
    source: &mut super::save::Source,
    page: &str,
    ops: &Value,
    attachments: Option<&DocumentChange>,
    display_agent: Option<Value>,
    operation_id: Option<&str>,
    clock: &dyn Fn() -> crate::Result<u64>,
) -> crate::Result<Edited> {
    validate(ops, attachments)?;
    let body = body(ops, attachments);
    let (prepared, receipt) = super::prepare_blocks_publication(
        &source.store,
        &source.keyring,
        page,
        action(&body, display_agent, operation_id),
        &mut source.decoder,
        clock,
    )?;
    Ok(Edited { prepared, receipt })
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
        batch.attachments.as_ref(),
        None,
        Some(&batch.operation_id),
        clock,
    )?;
    let prepared =
        super::save::structured(&source, &batch.page, &batch.operation_id, done.prepared)?;
    Ok((prepared, done.receipt))
}
