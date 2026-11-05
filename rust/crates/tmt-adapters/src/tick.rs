//! One explicit clock lifetime over canonical jobs and finite extension work.
mod clock;
mod lease;
mod port;
mod schedule;
pub mod timer;
use crate::storage::StorageError;
pub use clock::run;
pub use lease::{Lease, status};
pub use port::JobPort;
pub use schedule::{TickJob, TickPage, TickPort, TickReport, TickWindow};
#[derive(Debug)]
pub enum TickError {
    Io(std::io::Error),
    Storage(StorageError),
    Busy(serde_json::Value),
    LeaseLost,
    Invalid,
    SchemaChanged,
    Stopped,
    Protocol,
    Command(crate::process::CommandError),
    Operation(crate::orchestration::OrchReadFailure),
}
impl TickError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Io(_) => "TICK_IO",
            Self::Storage(_) => "TICK_STORAGE_UNAVAILABLE",
            Self::Busy(_) => "TICK_CLOCK_RUNNING",
            Self::LeaseLost => "TICK_LEASE_LOST",
            Self::Invalid => "TICK_INPUT_INVALID",
            Self::SchemaChanged => "TICK_SCHEMA_CHANGED",
            Self::Stopped => "TICK_STOPPED",
            Self::Protocol => "TICK_PROTOCOL_INVALID",
            Self::Command(_) => "TICK_CALL_UNCONFIRMED",
            Self::Operation(error) => error.code(),
        }
    }
}
impl std::fmt::Display for TickError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e)=>write!(f,"Tick I/O failed: {e}"),
            Self::Storage(e)=>e.fmt(f),
            Self::Busy(v)=>match v["holder"]["pid"].as_u64() {
                Some(pid)=>write!(f,"Another clock holds the lease (process {pid})."),
                None=>f.write_str("Another clock holds the lease; its holder is unconfirmed."),
            },
            Self::SchemaChanged=>f.write_str("Storage was upgraded; start a clock with the current build."),
            Self::Stopped=>f.write_str("The clock stopped before starting another call."),
            Self::Protocol=>f.write_str("The clock received an invalid API response; inspect the recorded operation before retrying."),
            Self::Command(e)=>write!(f,"Clock call could not be confirmed: {e}"),
            Self::Operation(e)=>e.fmt(f),
            Self::LeaseLost=>f.write_str("The clock no longer owns its recorded lease."),
            Self::Invalid=>f.write_str("Invalid clock input or retained lease; inspect its status before starting another clock."),
        }
    }
}
impl std::error::Error for TickError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            Self::Storage(e) => Some(e),
            Self::Command(e) => Some(e),
            Self::Operation(e) => Some(e),
            _ => None,
        }
    }
}
impl From<std::io::Error> for TickError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}
impl From<StorageError> for TickError {
    fn from(e: StorageError) -> Self {
        Self::Storage(e)
    }
}

impl From<crate::orchestration::OrchReadFailure> for TickError {
    fn from(error: crate::orchestration::OrchReadFailure) -> Self {
        Self::Operation(error)
    }
}
