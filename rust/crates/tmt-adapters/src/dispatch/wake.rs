//! The one-shot advisory wake after canonical dispatch acceptance has committed.
use super::*;
use crate::storage::Storage;
use tmt_core::settings::Settings;
pub struct DispatchWake<'a> {
    pub sender: &'a str,
    pub text: &'a str,
    pub passthrough: bool,
}
/// At most this many recipients of one roster post are woken; the rest stay inbox work.
const ROSTER_WAKE_MAX: usize = 8;
pub fn wake_direct(
    storage: &mut Storage,
    receipt: &DispatchReceipt,
    created: bool,
    settings: &Settings,
    input: DispatchWake<'_>,
) -> Option<WakeState> {
    if !created || receipt.items.len() != 1 || receipt.items[0].acceptance != Acceptance::Queued {
        return None;
    }
    Some(wake_item(storage, &receipt.items[0], settings, &input))
}
/// A roster post to the lead or to mentioned members is the person asking each of them
/// directly, so each newly queued recipient gets the same one-shot wake as a direct
/// request (#5704). The states are advisory and not reported; `requests.show` observes them.
pub fn wake_roster(
    storage: &mut Storage,
    receipt: &DispatchReceipt,
    created: bool,
    settings: &Settings,
    input: DispatchWake<'_>,
) {
    if !created {
        return;
    }
    for item in receipt
        .items
        .iter()
        .filter(|item| item.acceptance == Acceptance::Queued)
        .take(ROSTER_WAKE_MAX)
    {
        wake_item(storage, item, settings, &input);
    }
}
fn wake_item(
    storage: &mut Storage,
    item: &DispatchItem,
    settings: &Settings,
    input: &DispatchWake<'_>,
) -> WakeState {
    let delay =
        std::time::Duration::from_secs_f64(settings.paste_enter_delay_ms.min(500.0) / 1000.0);
    if input.passthrough {
        crate::delivery::deliver_request(
            storage,
            &item.request_id,
            &item.recipient_id,
            input.text,
            delay,
        )
    } else {
        let message = crate::delivery::queued_wake(
            input.sender,
            Some(input.text),
            &item.request_id,
            &item.recipient_id,
        );
        crate::delivery::wake_request(
            storage,
            &item.request_id,
            &item.recipient_id,
            &message,
            delay,
        )
    }
}
