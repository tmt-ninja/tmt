use serde_json::Value;

#[test]
fn versioned_vector_matches_native_renderer() {
    let vector: Value = serde_json::from_str(include_str!("vectors/v1.json")).unwrap();
    let registry: Value = serde_json::from_str(&tmt_tui_wasm::registry_json()).unwrap();
    assert_eq!(registry, vector["registry"]);
    for case in vector["cases"].as_array().unwrap() {
        let input = &case["input"];
        let actual = match tmt_tui_wasm::render_json(
            input["component"].as_str().unwrap(),
            input["props_json"].as_str().unwrap(),
            input["width"].as_u64().unwrap() as u32,
            input["height"].as_u64().unwrap() as u32,
        ) {
            Ok(json) => serde_json::json!({"ok": serde_json::from_str::<Value>(&json).unwrap()}),
            Err(error) => serde_json::json!({"error": error.code}),
        };
        assert_eq!(actual, case["expected"], "{}", case["name"]);
    }
}
