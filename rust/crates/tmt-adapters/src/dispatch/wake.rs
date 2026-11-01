//! The one-shot advisory wake after canonical dispatch acceptance has committed.
use super::*;
use crate::storage::Storage;
use tmt_core::settings::Settings;
pub struct DispatchWake<'a> {
    pub sender: &'a str,
    pub text: &'a str,
    pub passthrough: bool,
}
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
    let item = &receipt.items[0];
    let delay =
        std::time::Duration::from_secs_f64(settings.paste_enter_delay_ms.min(500.0) / 1000.0);
    Some(if input.passthrough {
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
    })
}
