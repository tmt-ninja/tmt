//! `merge(base, remote, local)`: the only block operation that needs a base is a whole-text
//! replacement. The agent read `base`, wrote `local`, and the page has moved on to `remote`; the
//! agent's hunks (base → local) are applied to the current text so concurrent typing outside
//! them stays. The base only locates hunks; it never refuses a write.
//!
//! The algorithm is pinned by `contracts/vectors/block-text-merge-v1.json`, which the TypeScript
//! mirror in `colab-client` runs as well. Units are Unicode scalar values; offsets in hunks and in
//! the dropped report count them, not bytes or UTF-16 units.
use serde::Serialize;

/// The edit distance, after the common prefix and suffix are removed, above which a diff is one
/// hunk instead of an exact script. It bounds the diff's memory at about 4 MiB.
pub const DIFF_LIMIT: usize = 1024;

/// A replacement of `base[from..to]` by `text`; an insertion has `from == to`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hunk {
    pub from: usize,
    pub to: usize,
    pub text: Vec<char>,
}

/// An agent hunk that overlapped a concurrent edit: the page keeps the other writer's text and
/// the receipt lists this, in base offsets, so the agent can read the block again.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dropped {
    pub from: usize,
    pub to: usize,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Merged {
    pub text: String,
    pub dropped: Vec<Dropped>,
}

#[derive(Clone, Copy)]
enum Op {
    Keep,
    Delete,
    Insert,
}

const NEG: i32 = i32::MIN;

/// The predecessor of diagonal `k` in the round after `prev`: the furthest `x` and whether the
/// last step was an insertion (down). Cells outside the grid are unreachable. A tie in `x`
/// prefers the deletion, so the script is the same in every implementation.
fn pick(prev: impl Fn(isize) -> i32, k: isize, n: isize, m: isize) -> Option<(i32, bool)> {
    let down = prev(k + 1);
    let right = prev(k - 1);
    let down_ok = down != NEG && down as isize - k <= m;
    let right_ok = right != NEG && (right as isize) < n;
    match (right_ok, down_ok) {
        (true, true) if right as isize + 1 >= down as isize => Some((right + 1, false)),
        (true, true) | (false, true) => Some((down, true)),
        (true, false) => Some((right + 1, false)),
        (false, false) => None,
    }
}

/// Myers' O(ND) script for `a → b`, or `None` when the distance exceeds [`DIFF_LIMIT`].
fn script(a: &[char], b: &[char]) -> Option<Vec<Op>> {
    let (n, m) = (a.len() as isize, b.len() as isize);
    let max = (n + m).min(DIFF_LIMIT as isize);
    let off = max + 1;
    let mut v = vec![NEG; (2 * max + 3) as usize];
    v[(1 + off) as usize] = 0;
    let mut trace: Vec<Vec<i32>> = Vec::new();
    let mut found = None;
    'rounds: for d in 0..=max {
        trace.push(v[(off - d - 1) as usize..=(off + d + 1) as usize].to_vec());
        let mut k = -d;
        while k <= d {
            let picked = pick(|j| v[(j + off) as usize], k, n, m);
            match picked {
                None => v[(k + off) as usize] = NEG,
                Some((x, _)) => {
                    let (mut x, mut y) = (x as isize, x as isize - k);
                    while x < n && y < m && a[x as usize] == b[y as usize] {
                        x += 1;
                        y += 1;
                    }
                    v[(k + off) as usize] = x as i32;
                    if x == n && y == m {
                        found = Some(d);
                        break 'rounds;
                    }
                }
            }
            k += 2;
        }
    }
    let last = found?;
    let (mut x, mut y) = (n, m);
    let mut ops = Vec::new();
    for d in (1..=last).rev() {
        let snap = &trace[d as usize];
        let (px, down) = pick(|j| snap[(j + d + 1) as usize], x - y, n, m)?;
        let (px, py) = if down {
            (px as isize, px as isize - (x - y + 1))
        } else {
            (px as isize - 1, px as isize - 1 - (x - y - 1))
        };
        while x > px + isize::from(!down) && y > py + isize::from(down) {
            x -= 1;
            y -= 1;
            ops.push(Op::Keep);
        }
        if down {
            y -= 1;
            ops.push(Op::Insert);
        } else {
            x -= 1;
            ops.push(Op::Delete);
        }
    }
    while x > 0 && y > 0 {
        x -= 1;
        y -= 1;
        ops.push(Op::Keep);
    }
    ops.reverse();
    Some(ops)
}

/// The hunks that turn `a` into `b`: the common prefix and suffix are kept, the middle is diffed
/// with Myers' algorithm, and each maximal run of changes between kept characters is one hunk.
/// Beyond [`DIFF_LIMIT`] the whole middle is one hunk.
pub fn hunks(a: &[char], b: &[char]) -> Vec<Hunk> {
    let prefix = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    let suffix = a[prefix..]
        .iter()
        .rev()
        .zip(b[prefix..].iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    let (ma, mb) = (&a[prefix..a.len() - suffix], &b[prefix..b.len() - suffix]);
    if ma.is_empty() && mb.is_empty() {
        return Vec::new();
    }
    let Some(ops) = script(ma, mb) else {
        return vec![Hunk {
            from: prefix,
            to: prefix + ma.len(),
            text: mb.to_vec(),
        }];
    };
    let (mut ai, mut bi) = (0, 0);
    let mut out = Vec::new();
    let mut open: Option<Hunk> = None;
    for op in ops {
        match op {
            Op::Keep => {
                out.extend(open.take());
                ai += 1;
                bi += 1;
            }
            Op::Delete => {
                let hunk = open.get_or_insert_with(|| Hunk {
                    from: prefix + ai,
                    to: prefix + ai,
                    text: Vec::new(),
                });
                hunk.to += 1;
                ai += 1;
            }
            Op::Insert => {
                let hunk = open.get_or_insert_with(|| Hunk {
                    from: prefix + ai,
                    to: prefix + ai,
                    text: Vec::new(),
                });
                hunk.text.push(mb[bi]);
                bi += 1;
            }
        }
    }
    out.extend(open);
    out
}

/// Two hunks conflict when their deleted ranges overlap, or one inserts strictly inside what the
/// other deletes. Insertions at the same point, or at the edge of a deletion, do not.
fn conflicts(remote: &Hunk, local: &Hunk) -> bool {
    remote.from < local.to && local.from < remote.to
}

/// What happens to an agent hunk that overlaps a concurrent edit.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Overlap {
    /// The page's text stays and the whole hunk is dropped and reported: an agent rereads.
    #[default]
    Remote,
    /// The hunk's new text is kept right after the page's own text there and only its deletion is
    /// dropped (and reported): a person's typing is never lost. A hunk that only deletes is
    /// dropped whole.
    Both,
}

/// Apply the agent's hunks (`base → local`) to the current text. Hunks that overlap a concurrent
/// edit are dropped and reported; a hunk the other writer also made is absorbed; insertions at
/// one point keep the other writer's first.
pub fn merge(base: &str, remote: &str, local: &str) -> Merged {
    merge_with(base, remote, local, Overlap::Remote)
}

/// [`merge`], with the choice of what an overlap does.
pub fn merge_with(base: &str, remote: &str, local: &str, overlap: Overlap) -> Merged {
    let base: Vec<char> = base.chars().collect();
    let remote_hunks = hunks(&base, &remote.chars().collect::<Vec<_>>());
    let local_hunks = hunks(&base, &local.chars().collect::<Vec<_>>());
    let mut accepted: Vec<(Hunk, u8)> = remote_hunks.iter().map(|h| (h.clone(), 0)).collect();
    let mut dropped = Vec::new();
    for hunk in &local_hunks {
        if remote_hunks.contains(hunk) {
            continue;
        }
        let over: Vec<&Hunk> = remote_hunks
            .iter()
            .filter(|other| conflicts(other, hunk))
            .collect();
        if over.is_empty() {
            accepted.push((hunk.clone(), 1));
            continue;
        }
        if overlap == Overlap::Both && !hunk.text.is_empty() {
            // The typed text lands after the page's own text where it overlapped.
            let at = over.iter().map(|other| other.to).max().unwrap_or(hunk.to);
            accepted.push((
                Hunk {
                    from: at,
                    to: at,
                    text: hunk.text.clone(),
                },
                1,
            ));
            if hunk.from < hunk.to {
                dropped.push(Dropped {
                    from: hunk.from,
                    to: hunk.to,
                    text: String::new(),
                });
            }
        } else {
            dropped.push(Dropped {
                from: hunk.from,
                to: hunk.to,
                text: hunk.text.iter().collect(),
            });
        }
    }
    accepted.sort_by_key(|(hunk, side)| (hunk.from, hunk.to, *side));
    let mut text = String::new();
    let mut cursor = 0;
    for (hunk, _) in accepted {
        text.extend(&base[cursor..hunk.from]);
        text.extend(&hunk.text);
        cursor = hunk.to;
    }
    text.extend(&base[cursor..]);
    Merged { text, dropped }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn vectors() -> Value {
        serde_json::from_str(include_str!(
            "../../../../contracts/vectors/block-text-merge-v1.json"
        ))
        .unwrap()
    }
    fn hunk(value: &Value) -> Hunk {
        Hunk {
            from: value["from"].as_u64().unwrap() as usize,
            to: value["to"].as_u64().unwrap() as usize,
            text: value["text"].as_str().unwrap().chars().collect(),
        }
    }
    fn chars(value: &Value) -> Vec<char> {
        value.as_str().unwrap().chars().collect()
    }

    #[test]
    fn the_diff_limit_is_the_vectors_limit() {
        assert_eq!(vectors()["diffLimit"].as_u64(), Some(DIFF_LIMIT as u64));
    }

    #[test]
    fn diff_matches_the_vectors() {
        let vectors = vectors();
        for case in vectors["hunks"].as_array().unwrap() {
            let expected: Vec<Hunk> = case["hunks"].as_array().unwrap().iter().map(hunk).collect();
            assert_eq!(
                hunks(&chars(&case["base"]), &chars(&case["local"])),
                expected,
                "{}",
                case["name"]
            );
        }
    }

    fn check_merges(set: &str, overlap: Overlap) {
        let vectors = vectors();
        for case in vectors[set].as_array().unwrap() {
            let merged = merge_with(
                case["base"].as_str().unwrap(),
                case["remote"].as_str().unwrap(),
                case["local"].as_str().unwrap(),
                overlap,
            );
            let dropped: Vec<Hunk> = case["dropped"]
                .as_array()
                .unwrap()
                .iter()
                .map(hunk)
                .collect();
            assert_eq!(
                merged.text,
                case["merged"].as_str().unwrap(),
                "{}",
                case["name"]
            );
            assert_eq!(
                merged
                    .dropped
                    .iter()
                    .map(|d| Hunk {
                        from: d.from,
                        to: d.to,
                        text: d.text.chars().collect()
                    })
                    .collect::<Vec<_>>(),
                dropped,
                "{}",
                case["name"]
            );
        }
    }

    #[test]
    fn merge_matches_the_vectors() {
        check_merges("merges", Overlap::Remote);
    }

    #[test]
    fn merge_with_both_matches_the_vectors() {
        check_merges("mergesBoth", Overlap::Both);
    }

    #[test]
    fn the_default_overlap_is_remote() {
        assert_eq!(Overlap::default(), Overlap::Remote);
        let (b, r, l) = ("abcd", "ad", "abXcd");
        assert_eq!(merge(b, r, l), merge_with(b, r, l, Overlap::Remote));
    }

    #[test]
    fn a_script_replays_to_the_local_text() {
        // Every diff must rebuild `local` from `base`, for inputs the vectors do not name.
        let samples = [
            ("kitten sitting", "sitting kitten"),
            ("aaaa", "aaaaaaaa"),
            ("abcabba", "cbabac"),
            ("", ""),
            ("same", "same"),
            ("line one\nline two\n", "line two\nline one\nline three\n"),
        ];
        for (base, local) in samples {
            let (a, b): (Vec<char>, Vec<char>) = (base.chars().collect(), local.chars().collect());
            let mut rebuilt: Vec<char> = Vec::new();
            let mut cursor = 0;
            for hunk in hunks(&a, &b) {
                rebuilt.extend(&a[cursor..hunk.from]);
                rebuilt.extend(&hunk.text);
                cursor = hunk.to;
            }
            rebuilt.extend(&a[cursor..]);
            assert_eq!(rebuilt, b, "{base:?} -> {local:?}");
        }
    }
}
