//! A finite component proves its native parent through the public clock port.
use crate::core::{Core, Error};
use signal_hook::{
    SigId,
    consts::{SIGINT, SIGTERM},
    flag, low_level,
};
use std::sync::{Arc, atomic::AtomicBool};
pub(super) struct Cancellation {
    pub flag: Arc<AtomicBool>,
    registrations: Vec<SigId>,
}
impl Cancellation {
    pub fn install() -> Result<Self, Error> {
        let mut owner = Self {
            flag: Arc::new(AtomicBool::new(false)),
            registrations: vec![],
        };
        for signal in [SIGINT, SIGTERM] {
            owner
                .registrations
                .push(flag::register(signal, owner.flag.clone())?);
        }
        Ok(owner)
    }
}
impl Drop for Cancellation {
    fn drop(&mut self) {
        for registration in self.registrations.drain(..).rev() {
            low_level::unregister(registration);
        }
    }
}
fn validates(document: &serde_json::Value, token: &str, parent: u32) -> bool {
    document["schemaVersion"] == 1
        && document["state"] == "running"
        && document["holder"]["token"] == token
        && document["holder"]["pid"] == parent
}
pub(super) fn verify(core: &Core, token: &str) -> Result<(), Error> {
    let status = core.api("tick.status", serde_json::json!({}))?;
    if !validates(&status, token, nix::unistd::getppid().as_raw() as u32) {
        return Err(Error::new(
            "DIGEST_CLOCK_LOST",
            "The unified clock lease or native parent could not be confirmed.",
        ));
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn component_requires_the_live_exact_lease_and_its_native_parent() {
        let good = json!({"schemaVersion":1,"state":"running","holder":{"token":"exact","pid":42}});
        assert!(validates(&good, "exact", 42));
        for (key, value) in [("state", json!("unconfirmed")), ("schemaVersion", json!(2))] {
            let mut bad = good.clone();
            bad[key] = value;
            assert!(!validates(&bad, "exact", 42));
        }
        assert!(!validates(&good, "other", 42));
        assert!(!validates(&good, "exact", 43));
    }
}
