//! The offline example's actual output boundary; no installed command or provider.
#[allow(dead_code)]
#[path = "../examples/compose_hosting.rs"]
mod compose_hosting;
#[allow(dead_code)]
#[path = "support/deploy_fixture.rs"]
mod deploy_fixture;
#[path = "support/hosting_fixture.rs"]
mod hosting_fixture;

use deploy_fixture::Root;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{ffi::OsString, fs, path::Path};
use tmt_remote::{
    hosting::{self, HostingManifest},
    limits,
};

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn inputs() -> (Value, Value, Value) {
    // Real Colab declaration/Rules bytes; only this small Hosting inventory is Remote-authored.
    let mut envelope: Value = serde_json::from_str(include_str!(
        "../../../../tmt-colab/contracts/vectors/deploy-declaration-v1.json"
    ))
    .unwrap();
    let manifest = HostingManifest::parse(&json!({"version":1,"files":[{
        "path":"/index.html", "sha256":digest(b"hello"), "length":5,
        "contentType":"text/html",
        "csp":"default-src 'none'; script-src 'self'; style-src 'self'"
    }]}))
    .unwrap();
    let bundle = json!({"version":1,"manifestDigest":manifest.digest(),"files":[{
        "path":"/index.html","fixtureBytes":b"hello"
    }]});
    let mut declaration: Value =
        serde_json::from_str(envelope["declaration"].as_str().unwrap()).unwrap();
    declaration["hosting"] = serde_json::to_value(&manifest).unwrap();
    let bytes = serde_json::to_string(&declaration).unwrap();
    envelope["declarationDigest"] = json!(digest(bytes.as_bytes()));
    envelope["declaration"] = json!(bytes);
    let composition = hosting_fixture::compose(&[hosting::HostingInput {
        extension: "colab",
        declaration: envelope["declaration"].as_str().unwrap().as_bytes(),
        bundle: &hosting_fixture::parse(&manifest, &serde_json::to_vec(&bundle).unwrap()).unwrap(),
    }])
    .unwrap()
    .unwrap();
    let pinned: Value =
        serde_json::from_str(include_str!("fixtures/hosting/serving-config.json")).unwrap();
    assert_eq!(composition.config(), &pinned);
    (envelope, bundle, composition.view())
}

fn invoke(root: &Path, envelope: &[u8], bundle: &[u8]) -> (i32, Vec<u8>, Vec<u8>) {
    fs::create_dir_all(root.join("dist-hosted")).unwrap();
    fs::write(root.join("tmt-colab"), b"fixture executable").unwrap();
    let declaration_path = root.join("declaration.json");
    let bundle_path = root.join("bundle.json");
    fs::write(&declaration_path, envelope).unwrap();
    fs::write(&bundle_path, bundle).unwrap();
    // Translate only the scenario's fixture bytes to a real installed-tree manifest.
    if let Ok(mut value) = serde_json::from_slice::<Value>(bundle) {
        if let Some(files) = value["files"].as_array_mut() {
            let declaration: Value = serde_json::from_slice(envelope).unwrap_or(Value::Null);
            let portable: Value = declaration["declaration"]
                .as_str()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(Value::Null);
            for (index, file) in files.iter_mut().enumerate() {
                if let Some(raw) = file
                    .as_object_mut()
                    .and_then(|item| item.remove("fixtureBytes"))
                {
                    let raw: Vec<u8> = serde_json::from_value(raw).unwrap();
                    let mut metadata = portable["hosting"]["files"][index].clone();
                    let path = root.join("dist-hosted/index.html");
                    fs::write(&path, raw).unwrap();
                    for (key, extra) in file.as_object().unwrap() {
                        if key != "path" {
                            metadata[key] = extra.clone();
                        }
                    }
                    metadata["path"] = json!(path);
                    *file = metadata;
                }
            }
            fs::write(&bundle_path, serde_json::to_vec(&value).unwrap()).unwrap();
        }
    }
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let code = compose_hosting::execute(
        &[
            declaration_path.into_os_string(),
            bundle_path.into_os_string(),
            root.join("tmt-colab").into_os_string(),
        ],
        &mut stdout,
        &mut stderr,
    );
    (code, stdout, stderr)
}

fn refusal(root: &Path, envelope: &[u8], bundle: &[u8], expected: &str) {
    let (code, stdout, stderr) = invoke(root, envelope, bundle);
    assert_eq!(code, 1);
    assert!(stdout.is_empty(), "refusal published partial output");
    assert_eq!(stderr, format!("{expected}\n").as_bytes());
}

#[test]
fn colab_declaration_reproduces_pinned_hosting_view_and_digest() {
    let root = Root::new();
    let (envelope, bundle, expected) = inputs();
    let (code, stdout, stderr) = invoke(
        &root.0,
        &serde_json::to_vec(&envelope).unwrap(),
        &serde_json::to_vec(&bundle).unwrap(),
    );
    assert_eq!(code, 0);
    assert!(stderr.is_empty());
    let actual: Value = serde_json::from_slice(&stdout).unwrap();
    assert_eq!(actual, expected);
    assert_eq!(actual["digest"], expected["digest"]);
    let generated = actual["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == "/tmt/declarations/colab.json")
        .unwrap();
    assert_eq!(generated["rawDigest"], envelope["declarationDigest"]);
    assert_eq!(
        generated["rawLength"],
        envelope["declaration"].as_str().unwrap().len()
    );
    assert_eq!(generated["contentType"], "application/json");
}

#[test]
fn malformed_bundle_and_declaration_refuse_without_stdout() {
    let root = Root::new();
    let (envelope, bundle, _) = inputs();
    for (change, code) in [
        ("digest", "hosting-digest"),
        ("files", "hosting-file-set"),
        ("unknown", "hosting-shape"),
        ("bytes", "hosting-digest"),
    ] {
        let mut edited = bundle.clone();
        match change {
            "digest" => edited["manifestDigest"] = json!("0".repeat(64)),
            "files" => edited["files"] = json!([]),
            "unknown" => edited["files"][0]["unknown"] = json!(true),
            "bytes" => edited["files"][0]["fixtureBytes"] = json!(b"HELLO"),
            _ => unreachable!(),
        }
        refusal(
            &root.0,
            &serde_json::to_vec(&envelope).unwrap(),
            &serde_json::to_vec(&edited).unwrap(),
            code,
        );
    }
    let mut edited = envelope.clone();
    edited["unknown"] = json!(true);
    refusal(
        &root.0,
        &serde_json::to_vec(&edited).unwrap(),
        &serde_json::to_vec(&bundle).unwrap(),
        "discovery-envelope",
    );
    edited = envelope;
    edited["declarationDigest"] = json!("0".repeat(64));
    refusal(
        &root.0,
        &serde_json::to_vec(&edited).unwrap(),
        &serde_json::to_vec(&bundle).unwrap(),
        "discovery-digest",
    );
}

#[test]
fn missing_hosting_manifest_is_not_an_empty_success() {
    let root = Root::new();
    refusal(
        &root.0,
        include_bytes!("../../../../tmt-colab/contracts/vectors/deploy-declaration-v1.json"),
        b"{}",
        "hosting-manifest-absent",
    );
}

#[test]
fn each_input_cap_refuses_before_composition() {
    let root = Root::new();
    let (envelope, bundle, _) = inputs();
    refusal(
        &root.0,
        &vec![b' '; limits::DEPLOY_DECLARATION_REPLY_BYTES + 1],
        &serde_json::to_vec(&bundle).unwrap(),
        "discovery-envelope",
    );
    refusal(
        &root.0,
        &serde_json::to_vec(&envelope).unwrap(),
        &vec![b' '; limits::HOSTING_REPLY_BYTES + 1],
        "hosting-bounds",
    );
}

#[test]
fn usage_and_unavailable_input_are_codes_not_input_echoes() {
    for (args, expected) in [
        (Vec::new(), "usage"),
        (
            vec![OsString::from("TOKEN_CANARY_NOT_A_FILE"); 3],
            "input-unavailable",
        ),
    ] {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        assert_eq!(compose_hosting::execute(&args, &mut stdout, &mut stderr), 1);
        assert!(stdout.is_empty());
        assert_eq!(stderr, format!("{expected}\n").as_bytes());
    }
}
