use serde_json::Value;

#[test]
fn text_bold_is_optional_and_must_be_boolean() {
    let render = |props| tmt_tui_wasm::render_json("text", props, 2, 1);
    let output: Value = serde_json::from_str(
        &render(
            r#"{"spans":[{"text":"A","role":"text"},{"text":"B","role":"waiting","bold":true}]}"#,
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(output["cells"][0]["bold"], false);
    assert_eq!(output["cells"][1]["bold"], true);
    assert!(render(r#"{"spans":[{"text":"A","role":"text","bold":1}]}"#).is_err());
}

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
        let mut expected = case["expected"].clone();
        if let Some(output) = expected.get_mut("ok").and_then(Value::as_object_mut)
            && let Some(runs) = output.remove("cells_rle")
        {
            let mut cells = Vec::new();
            for run in runs.as_array().unwrap() {
                let count = run[0].as_u64().unwrap() as usize;
                assert!(count > 0 && cells.len() + count <= 32_768);
                cells.extend(std::iter::repeat_n(run[1].clone(), count));
            }
            assert_eq!(
                cells.len(),
                output["width"].as_u64().unwrap() as usize
                    * output["height"].as_u64().unwrap() as usize
            );
            output.insert("cells".into(), Value::Array(cells));
        }
        assert_eq!(actual, expected, "{}", case["name"]);
    }
}
