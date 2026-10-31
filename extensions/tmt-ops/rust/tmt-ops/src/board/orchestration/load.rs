//! Public API reads, kept on the existing selected lane.
use super::model::{Overview, Query, Snapshot};
use crate::core::{Core, SquadError};
use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Read {
    pub query: Query,
    pub cursor: Option<u64>,
}
#[derive(Debug)]
pub(in crate::board) enum Observation {
    Ready(Snapshot),
    Unavailable,
    Failed(String),
}
impl Read {
    pub fn complete(&self, core: &Core) -> Observation {
        self.read_with(|operation, input| core.api(operation, input))
    }
    pub(super) fn read_with(
        &self,
        mut api: impl FnMut(&str, Value) -> Result<Value, SquadError>,
    ) -> Observation {
        let capabilities = match api("capabilities", json!({})) {
            Ok(value) => value,
            Err(error) if error.code == "API_INPUT_INVALID" => return Observation::Unavailable,
            Err(error) => return Observation::Failed(error.message),
        };
        let Some(operations) = capabilities["operations"].as_array() else {
            return Observation::Failed("Invalid Core capability observation.".into());
        };
        let supports = |operation: &str| operations.iter().any(|v| v.as_str() == Some(operation));
        if !supports("orchestration.read") {
            return Observation::Unavailable;
        }
        let result = api("orchestration.read", self.query.input())
            .map_err(|e| e.message)
            .and_then(Overview::decode)
            .and_then(|document| Snapshot::new(document, supports("orchestration.write")));
        match result {
            Ok(value) => Observation::Ready(value),
            Err(error) => Observation::Failed(error),
        }
    }
}
