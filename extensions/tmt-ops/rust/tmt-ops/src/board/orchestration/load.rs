//! Public API reads, kept on the existing selected lane.
use super::model::{Overview, Query, Route, Sending, Snapshot, TalkPair};
use crate::core::{Core, SquadError};
use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Read {
    pub query: Query,
    pub cursor: Option<u64>,
}
#[derive(Debug)]
pub(in crate::board) enum Observation {
    /// Boxed: a snapshot is far larger than the other outcomes.
    Ready(Box<Snapshot>),
    Unavailable,
    Failed(String),
}
impl Read {
    pub fn complete(&self, core: &Core) -> Observation {
        self.read_with(|operation, input| core.api(operation, input))
    }
    /// The `routes` pages and the `talks` view for the same members. An older Core refuses
    /// an unknown view (`ORCH_INPUT_INVALID`): that view is not available, never an error.
    fn sending(
        &self,
        api: &mut impl FnMut(&str, Value) -> Result<Value, SquadError>,
    ) -> Result<Sending, String> {
        let mut sending = Sending::default();
        let view = |name: &str, after: Option<&str>| {
            let mut input = json!({"view": name, "limit": ROUTES_PAGE});
            if !self.query.member.is_empty() {
                input["memberQuery"] = self.query.member.clone().into();
            }
            if let Some(after) = after {
                input["after"] = after.into();
            }
            input
        };
        let mut routes = std::collections::BTreeMap::new();
        let mut after: Option<String> = None;
        let mut available = true;
        for page in 0..ROUTES_PAGES {
            let value = match api("orchestration.read", view("routes", after.as_deref())) {
                Ok(value) => value,
                Err(error) if page == 0 && unknown_view(&error) => {
                    available = false;
                    break;
                }
                // More selected members than one matrix covers: say so, show none.
                Err(error) if error.code == "ORCH_LIMIT" => {
                    sending.truncated = true;
                    break;
                }
                Err(error) => return Err(error.message),
            };
            for row in value["routes"]
                .as_array()
                .ok_or("Invalid Orchestration routes.")?
            {
                let (key, route) = Route::read(row).ok_or("Invalid Orchestration route.")?;
                routes.insert(key, route);
            }
            after = value["nextAfter"].as_str().map(str::to_owned);
            if after.is_none() {
                break;
            }
            sending.truncated = page + 1 == ROUTES_PAGES;
        }
        sending.routes = available.then_some(routes);
        sending.talks = match api("orchestration.read", view("talks", None)) {
            Ok(value) => Some(
                value["pairs"]
                    .as_array()
                    .ok_or("Invalid Orchestration talks.")?
                    .iter()
                    .map(TalkPair::read)
                    .collect::<Option<_>>()
                    .ok_or("Invalid Orchestration talk pair.")?,
            ),
            Err(error) if unknown_view(&error) => None,
            Err(error) => return Err(error.message),
        };
        Ok(sending)
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
            .and_then(|document| {
                let sending = self.sending(&mut api)?;
                Snapshot::new(document, sending, supports("orchestration.write"))
            });
        match result {
            Ok(value) => Observation::Ready(Box::new(value)),
            Err(error) => Observation::Failed(error),
        }
    }
}

/// One `routes` page; the bounded read covers up to `ROUTES_PAGES` pages.
const ROUTES_PAGE: u64 = 256;
const ROUTES_PAGES: usize = 32;
fn unknown_view(error: &SquadError) -> bool {
    error.code == "ORCH_INPUT_INVALID"
}
