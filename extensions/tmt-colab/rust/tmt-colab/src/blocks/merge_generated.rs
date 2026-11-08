//! The seeded generated merge vectors (#6004): random base/remote/local triples, each merged under
//! both overlap modes by the native merge, which is the source of truth the TypeScript mirror in
//! `@tmt/colab-client` must match. This test regenerates the data and fails when the checked-in
//! file differs; `TMT_BLESS_VECTORS=1 cargo test -p tmt-colab merge_generated` rewrites it.
use super::merge::{Overlap, merge_with};
use serde_json::{Value, json};
use std::path::PathBuf;

const SEED: u64 = 0x6004_b10c;
const COUNT: usize = 500;
/// Overlaps are common because the alphabet is small; the astral, combining and CR/LF units
/// exercise scalar-value offsets.
const ALPHABET: &[char] = &['a', 'b', 'c', 'd', ' ', '\r', '\n', 'é', '🐈', '𝔘'];

/// SplitMix64: a fixed, dependency-free generator, so the file never depends on a crate version.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn run(&mut self) -> Vec<char> {
        (0..1 + self.below(3))
            .map(|_| ALPHABET[self.below(ALPHABET.len())])
            .collect()
    }
    /// One insertion, deletion or replacement of up to three units.
    fn edit(&mut self, text: &mut Vec<char>) {
        match self.below(3) {
            0 => {
                let at = self.below(text.len() + 1);
                let run = self.run();
                text.splice(at..at, run);
            }
            kind if !text.is_empty() => {
                let from = self.below(text.len());
                let to = (from + 1 + self.below(3)).min(text.len());
                let run = if kind == 2 { self.run() } else { Vec::new() };
                text.splice(from..to, run);
            }
            _ => {}
        }
    }
    fn variant(&mut self, base: &[char]) -> String {
        let mut text = base.to_vec();
        for _ in 0..self.below(4) {
            self.edit(&mut text);
        }
        text.into_iter().collect()
    }
}

fn result(base: &str, remote: &str, local: &str, overlap: Overlap) -> Value {
    let merged = merge_with(base, remote, local, overlap);
    json!({
        "merged": merged.text,
        "dropped": merged
            .dropped
            .iter()
            .map(|d| json!({"from": d.from, "to": d.to, "text": d.text}))
            .collect::<Vec<_>>(),
    })
}

fn path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../contracts/vectors/block-text-merge-generated-v1.json")
}

fn generate() -> String {
    let mut rng = Rng(SEED);
    let mut cases = Vec::new();
    for _ in 0..COUNT {
        let base: Vec<char> = (0..rng.below(41))
            .map(|_| ALPHABET[rng.below(ALPHABET.len())])
            .collect();
        let remote = rng.variant(&base);
        let local = rng.variant(&base);
        let base: String = base.into_iter().collect();
        let case = json!({
            "base": base,
            "remote": remote,
            "local": local,
            "results": {
                "remote": result(&base, &remote, &local, Overlap::Remote),
                "both": result(&base, &remote, &local, Overlap::Both),
            },
        });
        cases.push(serde_json::to_string(&case).unwrap());
    }
    format!(
        "{{\n  \"format\": \"tmt-colab-block-text-merge-generated\",\n  \"version\": 1,\n  \
         \"description\": \"Seeded random base/remote/local triples (splitmix64, seed 0x6004b10c) \
         merged under overlap remote and both; the native merge produced the results and the \
         TypeScript merge must match them. Regenerate with TMT_BLESS_VECTORS=1 cargo test -p \
         tmt-colab merge_generated.\",\n  \"count\": {COUNT},\n  \"cases\": [\n    {}\n  ]\n}}\n",
        cases.join(",\n    ")
    )
}

#[test]
fn the_generated_merge_vectors_are_current() {
    let fresh = generate();
    if std::env::var_os("TMT_BLESS_VECTORS").is_some() {
        std::fs::write(path(), &fresh).unwrap();
        return;
    }
    let stored = std::fs::read_to_string(path()).expect("block-text-merge-generated-v1.json");
    assert!(
        stored == fresh,
        "block-text-merge-generated-v1.json is stale; run TMT_BLESS_VECTORS=1 cargo test -p tmt-colab merge_generated"
    );
}

#[test]
fn an_untouched_side_leaves_the_other_sides_text() {
    let parsed: Value = serde_json::from_str(&generate()).unwrap();
    let mut overlapped = 0;
    for case in parsed["cases"].as_array().unwrap() {
        let text = |key: &str| case[key].as_str().unwrap();
        for mode in ["remote", "both"] {
            let got = &case["results"][mode];
            if text("local") == text("base") {
                assert_eq!(got["merged"], text("remote").to_owned());
            }
            if text("remote") == text("base") {
                assert_eq!(got["merged"], text("local").to_owned());
            }
        }
        if !case["results"]["remote"]["dropped"]
            .as_array()
            .unwrap()
            .is_empty()
        {
            overlapped += 1;
        }
    }
    assert!(overlapped > 50, "only {overlapped} generated cases overlap");
}
