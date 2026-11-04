//! Local-extension object management through the existing ledger and deletion fence:
//! namespace removal and usage (version 2), and per-object removal and listing (version 4).
use super::dispatch::{self, ChannelEnd, Hub};
use crate::objects::{BackendError, BlobKey, IoBudget, NamespaceId, OpaqueKey};
use std::time::Instant;
use tmt_extension_objects::{
    AdmitInput, Bus, Bytes32, Call, Checkpoint, Context, Decision, Disclosure, ErrorCode,
    ListInput, Listed, Listing, Operation, Origin, Outcome, Request, Sha256Hex, Success, Usage,
    UsageScope,
};

pub(super) fn serve(
    hub: &Hub,
    bus: &Bus,
    request: &Request,
    deadline: Instant,
) -> Result<(), ChannelEnd> {
    let reply = |outcome| dispatch::send_until(hub, bus, request, outcome, deadline);
    let fail = |code| reply(Outcome::Failure(code));
    // Origin is service-owned. Mounted callers cannot request owner accounting, listing or
    // deletion, even when an extension would otherwise allow its admission callback.
    if request.origin != Origin::LocalExtension {
        return fail(ErrorCode::Denied);
    }
    let io = IoBudget {
        deadline,
        cancelled: &hub.stop,
    };
    let input = match &request.call {
        Call::RemoveNamespace(input) => AdmitInput::RemoveNamespace(input.clone()),
        Call::Usage(scope) => AdmitInput::Usage(*scope),
        Call::Remove(input) => AdmitInput::Remove(input.clone()),
        Call::List(input) => AdmitInput::List(input.clone()),
        _ => return fail(ErrorCode::Invalid),
    };
    let removes = matches!(request.call, Call::RemoveNamespace(_) | Call::Remove(_));
    let operation = |disclosure| Operation {
        input: input.clone(),
        disclosure,
    };
    let current = || {
        io.check().is_ok() && dispatch::stands(hub, request.origin) == Some(Context::LocalExtension)
    };
    for checkpoint in if removes {
        &[Checkpoint::Acquire, Checkpoint::Effect][..]
    } else {
        &[Checkpoint::Acquire][..]
    } {
        if !current() {
            return fail(ErrorCode::Unavailable);
        }
        let Some(decision) = dispatch::ask(
            hub,
            bus,
            request,
            Context::LocalExtension,
            *checkpoint,
            operation(None),
            deadline,
        )?
        else {
            return fail(ErrorCode::Unavailable);
        };
        match decision {
            Decision::Allow => {}
            Decision::Deny => return fail(ErrorCode::Denied),
            Decision::Unavailable => return fail(ErrorCode::Unavailable),
        }
    }
    if !current() {
        return fail(ErrorCode::Unavailable);
    }
    // Once removal is invoked, a lost fence/budget/admission is uncertainty, never rollback.
    let uncertain = if removes {
        ErrorCode::Unknown
    } else {
        ErrorCode::Unavailable
    };
    let finish = |outcome| dispatch::send_until_or(hub, bus, request, outcome, deadline, uncertain);
    let performed = match &request.call {
        Call::RemoveNamespace(input) => hub
            .writer
            .remove_namespace(NamespaceId(*input.namespace.as_bytes()), &io)
            .map(|()| (Success::Removed, Disclosure::Removed)),
        Call::Usage(scope) => {
            observe(hub, *scope, &io).map(|value| (Success::Usage(value), Disclosure::Usage(value)))
        }
        // The release that drops the charge commits before `removed` is disclosed.
        Call::Remove(input) => hub
            .writer
            .remove_object(
                BlobKey {
                    namespace: NamespaceId(*input.namespace.as_bytes()),
                    object: OpaqueKey(*input.opaque_key.as_bytes()),
                },
                *input.payload_sha256.as_bytes(),
                input.payload_bytes,
                &io,
            )
            .map(|()| (Success::Removed, Disclosure::Removed)),
        Call::List(input) => list(hub, input, &io).map(|listing| {
            let count = listing.entries.len() as u32;
            (Success::Listed(listing), Disclosure::Listed { count })
        }),
        _ => unreachable!("management call already checked"),
    };
    dispatch::between(hub, deadline);
    if !current() {
        return finish(Outcome::Failure(uncertain));
    }
    let (success, disclosure) = match performed {
        Ok(value) => value,
        Err(error) => {
            return finish(Outcome::Failure(if removes {
                dispatch::mutation_error(error)
            } else {
                ErrorCode::Unavailable
            }));
        }
    };
    let Some(decision) = dispatch::ask(
        hub,
        bus,
        request,
        Context::LocalExtension,
        Checkpoint::Disclose,
        operation(Some(disclosure)),
        deadline,
    )?
    else {
        return finish(Outcome::Failure(uncertain));
    };
    match decision {
        Decision::Allow => {}
        Decision::Deny if !removes => return finish(Outcome::Failure(ErrorCode::Denied)),
        Decision::Deny | Decision::Unavailable => return finish(Outcome::Failure(uncertain)),
    }
    dispatch::before_result(hub, deadline);
    if !current() {
        return finish(Outcome::Failure(uncertain));
    }
    if let (Call::Usage(scope), Success::Usage(observed)) = (&request.call, &success)
        && observe(hub, *scope, &io).ok().as_ref() != Some(observed)
    {
        return finish(Outcome::Failure(ErrorCode::Unavailable));
    }
    finish(Outcome::Success(success))
}
/// One page of committed objects: one more than asked is read to know whether `next`
/// names the last listed key.
fn list(hub: &Hub, input: &ListInput, io: &IoBudget<'_>) -> Result<Listing, BackendError> {
    let mut rows = hub.backend.list(
        NamespaceId(*input.namespace.as_bytes()),
        input.after.map(|key| OpaqueKey(*key.as_bytes())),
        input.limit + 1,
        io,
    )?;
    let more = rows.len() > input.limit as usize;
    rows.truncate(input.limit as usize);
    let entries: Vec<Listed> = rows
        .iter()
        .map(|row| Listed {
            opaque_key: Bytes32::from_bytes(row.key.0),
            payload_sha256: Sha256Hex::from_bytes(row.payload_sha256),
            payload_bytes: row.payload_bytes,
            adopted_at_ms: row.adopted_at_ms,
        })
        .collect();
    let next = more
        .then(|| entries.last().map(|entry| entry.opaque_key))
        .flatten();
    Ok(Listing { entries, next })
}
fn observe(hub: &Hub, scope: UsageScope, io: &IoBudget<'_>) -> Result<Usage, BackendError> {
    let namespace = match scope {
        UsageScope::Extension => None,
        UsageScope::Namespace(namespace) => Some(NamespaceId(*namespace.as_bytes())),
    };
    let value = hub.backend.usage(namespace, io)?;
    Ok(Usage {
        charged_bytes: value.charged_bytes,
        entries: value.entries,
        active_uploads: value.active_uploads,
        retained_identities: value.retained_identities,
    })
}
