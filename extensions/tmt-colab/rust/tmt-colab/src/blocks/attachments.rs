//! Attachments on a page of blocks (#6190): which `colab-attachment:` references a batch may add
//! and which descriptors it may remove. Pure values, like the rest of `blocks`: the descriptor
//! list is passed in and the new list handed back.
//!
//! The rules are checked when a batch is admitted, never when a state is folded. A rule on the
//! merged state could not survive two writers (one removes a descriptor while the other inserts an
//! image that names it), and a page that stopped folding would be worse than an image that cannot
//! draw. A reference already dangling in the base is therefore not judged again, so such a race
//! never blocks a later edit.

use std::collections::BTreeSet;

use serde_json::Value;
use tmt_colab_model::{
    attachment::{Descriptor, DocumentChange},
    values,
};

use super::ops::Refusal;

const REFERENCE: &str = "colab-attachment:";

/// The typed attachment change a batch body carries (`{"set"?: [descriptor], "remove"?: [id]}`),
/// or `None` when it carries none. The same type and shared vectors as an HTML save's.
pub fn change(body: &Value) -> Result<Option<DocumentChange>, Refusal> {
    match body.get("attachments") {
        None => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|_| Refusal::Invalid),
    }
}

/// The live references of a `blocks` value: each `colab-attachment:` string in an image's `src`
/// or a file's `href`, on a block that is not deleted. A tombstoned block shows nothing.
fn live(blocks: &Value) -> BTreeSet<String> {
    references(blocks, false)
}

/// The references of the blocks that are on the page: live ones, and with `tombstoned` the
/// deleted ones not yet purged too.
fn references(blocks: &Value, tombstoned: bool) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let Some(all) = blocks.as_object() else {
        return found;
    };
    for block in all
        .values()
        .filter(|b| tombstoned || b.get("deleted").is_none())
    {
        for (list, key) in [("images", "src"), ("files", "href")] {
            let Some(items) = block["props"].get(list).and_then(Value::as_array) else {
                continue;
            };
            for item in items {
                if let Some(text) = item.get(key).and_then(Value::as_str)
                    && text.starts_with(REFERENCE)
                {
                    found.insert(text.to_owned());
                }
            }
        }
    }
    found
}

/// The token of a reference the renderer resolves: 8 lowercase hex digits (a unique ID prefix) or
/// a full attachment ID, the HTML grammar (`text::attachment_token`, the one owner, which the
/// block schema applies to every image `src` and file `href`). `None` is a malformed reference.
fn token(reference: &str) -> Option<&str> {
    super::text::attachment_token(reference)
}

/// The one descriptor a token names in `list`: the full ID, or the only ID with that prefix.
fn resolve<'a>(token: &str, list: &'a [Descriptor]) -> Option<&'a Descriptor> {
    if token.len() == 8 {
        let mut named = list.iter().filter(|d| d.attachment_id.starts_with(token));
        let first = named.next()?;
        return named.next().is_none().then_some(first);
    }
    list.iter().find(|d| d.attachment_id == token)
}

/// The descriptors of `list` that the blocks on the page still reference, live or deleted and not
/// yet purged (an undo or a restore keeps its image). This is the page's reference set for the
/// 30-day sweep: a descriptor no block references any more is swept on the same schedule as a file
/// whose reference left an HTML page's source, without anyone running a detach. It only ever
/// widens what is kept: a short token that names several descriptors keeps them all, and a token
/// that names none keeps nothing.
pub fn referenced<'a>(blocks: &Value, list: &'a [Descriptor]) -> Vec<&'a Descriptor> {
    let tokens: BTreeSet<String> = references(blocks, true)
        .iter()
        .filter_map(|reference| token(reference).map(str::to_owned))
        .collect();
    list.iter()
        .filter(|descriptor| {
            tokens.iter().any(|token| {
                if token.len() == 8 {
                    descriptor.attachment_id.starts_with(token.as_str())
                } else {
                    descriptor.attachment_id == *token
                }
            })
        })
        .collect()
}

/// Admit `change` to a batch that took `before` to `next`, on a page that holds `current`.
/// Returns the list the page holds afterwards when the change alters it, `None` when it leaves it
/// as it is. `source_sha256` is the digest of the page's `html` root, which every added descriptor
/// is bound to (stable on a page of blocks: empty, or the frozen legacy source).
///
/// A reference the batch adds (live in `next`, not in `before`) must be well formed and name one
/// descriptor of the list afterwards; no live reference in `next` may name a descriptor the change
/// removes.
pub fn admit(
    before: &Value,
    next: &Value,
    current: &[Descriptor],
    change: Option<&DocumentChange>,
    source_sha256: &[u8; 32],
) -> Result<Option<Vec<Descriptor>>, Refusal> {
    let change = change.filter(|change| !change.is_empty());
    let after = match change {
        Some(change) => {
            change
                .validate(source_sha256)
                .map_err(|_| Refusal::Invalid)?;
            Some(change.apply(current).map_err(|_| Refusal::Invalid)?)
        }
        None => None,
    };
    let list = after.as_deref().unwrap_or(current);
    let (old, now) = (live(before), live(next));
    for reference in now.difference(&old) {
        let named = token(reference).and_then(|token| resolve(token, list));
        if named.is_none() {
            return Err(Refusal::Attachment);
        }
    }
    if let Some(change) = change {
        for id in change.remove.as_slice() {
            let held = now.iter().any(|reference| {
                token(reference)
                    .and_then(|token| resolve(token, current))
                    .is_some_and(|descriptor| descriptor.attachment_id == *id)
            });
            if held {
                return Err(Refusal::Attachment);
            }
        }
    }
    Ok(after)
}

#[cfg(test)]
mod tests;
