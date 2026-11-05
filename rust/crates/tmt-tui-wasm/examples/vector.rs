//! Native side of the shared wasm parity vector (one request per input line).
use serde_json::{Value, json};
use std::io::{self, BufRead};
fn main() {
    for line in io::stdin().lock().lines() {
        let line = line.expect("read request");
        let req: Value = serde_json::from_str(&line).expect("valid vector request");
        let out = if req["registry"] == true {
            json!({"ok": serde_json::from_str::<Value>(&tmt_tui_wasm::registry_json()).unwrap()})
        } else {
            let result = tmt_tui_wasm::render_json(
                req["component"].as_str().unwrap(),
                req["props_json"].as_str().unwrap(),
                req["width"].as_u64().unwrap() as u32,
                req["height"].as_u64().unwrap() as u32,
            );
            match result {
                Ok(output) => json!({"ok": serde_json::from_str::<Value>(&output).unwrap()}),
                Err(error) => json!({"error": error.code}),
            }
        };
        println!("{out}");
    }
}
