//! One request on Herdr's local socket API, for the one method its CLI does
//! not offer: `pane.focus` by pane name. Herdr's API is newline-delimited
//! JSON (`{"id","method","params"}` in, one `{"id","result"}` or
//! `{"id","error"}` line out). The socket is only the one core named, and the
//! whole exchange is bounded by the call's deadline and a reply size.

use crate::herdr::HerdrError;
use crate::run::RunError;
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    os::unix::net::UnixStream,
    time::Instant,
};

/// The most a reply may hold; a focus answer is a few hundred bytes.
const MAX_REPLY: u64 = 64 * 1024;
const ID: &str = "tmt-driver-herdr";

/// Sends one request to the server on `socket` and returns its `result`.
pub fn request(
    socket: &str,
    method: &str,
    params: Value,
    deadline: Instant,
) -> Result<Value, HerdrError> {
    let unfinished = || HerdrError::Process(RunError::Unfinished);
    let left = || {
        deadline
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
            .ok_or_else(unfinished)
    };
    let mut stream = UnixStream::connect(socket).map_err(|error| HerdrError::Api {
        code: "server_not_running".into(),
        message: format!("could not reach the Herdr socket: {}", error.kind()),
    })?;
    stream
        .set_write_timeout(Some(left()?))
        .map_err(|_| unfinished())?;
    let mut line = json!({"id": ID, "method": method, "params": params}).to_string();
    line.push('\n');
    stream
        .write_all(line.as_bytes())
        .map_err(|_| unfinished())?;
    stream
        .set_read_timeout(Some(left()?))
        .map_err(|_| unfinished())?;
    let mut reply = Vec::new();
    BufReader::new(stream.take(MAX_REPLY))
        .read_until(b'\n', &mut reply)
        .map_err(|_| unfinished())?;
    if reply.last() != Some(&b'\n') {
        return Err(HerdrError::Malformed("Herdr sent no complete reply"));
    }
    let mut document: Value = serde_json::from_slice(&reply)
        .map_err(|_| HerdrError::Malformed("Herdr returned malformed JSON"))?;
    if document["id"] != ID {
        return Err(HerdrError::Malformed("Herdr answered another request"));
    }
    if let Some(error) = document.get("error") {
        return Err(
            crate::herdr::api_error_value(error).unwrap_or(HerdrError::Malformed(
                "Herdr failed without a documented error",
            )),
        );
    }
    match document.get_mut("result") {
        Some(result) => Ok(result.take()),
        None => Err(HerdrError::Malformed("Herdr returned no result")),
    }
}
