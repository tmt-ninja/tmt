//! Fractional sort keys for siblings (`pos`): a string over `0-9A-Za-z` that never ends in `0`, so
//! a key always fits between any two others. Siblings sort by `(pos, id)`; two writers that
//! compute the same key from the same state keep a stable order by id.
use crate::closed::{Invalid, Result};

const DIGITS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
pub const MAX_LEN: usize = 64;

pub fn valid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_LEN
        && value.bytes().all(|b| DIGITS.contains(&b))
        && !value.ends_with('0')
}

fn digit(bytes: &[u8], at: usize, missing: usize) -> usize {
    bytes
        .get(at)
        .map_or(missing, |b| DIGITS.iter().position(|d| d == b).unwrap_or(0))
}

/// A key above `a` and below `b`; empty `a` is the start and empty `b` the end.
fn midpoint(a: &[u8], b: &[u8]) -> Vec<u8> {
    if !b.is_empty() {
        let mut shared = 0;
        while shared < b.len() && digit(a, shared, 0) == digit(b, shared, 0) {
            shared += 1;
        }
        if shared > 0 {
            let mut out = b[..shared].to_vec();
            out.extend(midpoint(a.get(shared..).unwrap_or(&[]), &b[shared..]));
            return out;
        }
    }
    let (low, high) = (digit(a, 0, 0), digit(b, 0, DIGITS.len()));
    if high - low > 1 {
        vec![DIGITS[(low + high) / 2]]
    } else if b.len() > 1 {
        vec![b[0]]
    } else {
        let mut out = vec![DIGITS[low]];
        out.extend(midpoint(a.get(1..).unwrap_or(&[]), &[]));
        out
    }
}

/// A key after `a`: the last digit counts up, and past `z` the key grows by one digit, so 2048
/// appends stay under the length limit.
fn append(a: &str) -> String {
    match a.as_bytes().last() {
        None => "V".into(),
        Some(&last) if last != b'z' => {
            let next = DIGITS[digit(&[last], 0, 0) + 1];
            format!("{}{}", &a[..a.len() - 1], next as char)
        }
        Some(_) => format!("{a}1"),
    }
}

/// A key before `b`: the first digit that is not `0` counts down, and below `1` the key gets a
/// leading `0`.
fn prepend(b: &str) -> String {
    let zeros = b.bytes().take_while(|c| *c == b'0').count();
    let (lead, rest) = b.split_at(zeros);
    match rest.as_bytes().first() {
        Some(&c) if c > b'1' => format!("{lead}{}", DIGITS[digit(&[c], 0, 0) - 1] as char),
        _ => format!("{lead}0z"),
    }
}

/// A key between `after` and `before` (`None` is the start or the end of the siblings).
pub fn between(after: Option<&str>, before: Option<&str>) -> Result<String> {
    // Equal or crossed neighbours (a collision from two writers) leave no room: go just after `a`.
    let before = before.filter(|b| after.is_none_or(|a| a < *b));
    let key = match (after, before) {
        (None, None) => "V".into(),
        (Some(a), None) => append(a),
        (None, Some(b)) => prepend(b),
        (Some(a), Some(b)) => {
            String::from_utf8(midpoint(a.as_bytes(), b.as_bytes())).map_err(|_| Invalid)?
        }
    };
    if valid(&key) { Ok(key) } else { Err(Invalid) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_fit_between_any_neighbours() {
        let mut keys = vec![between(None, None).unwrap()];
        let mut seed = 0x2545_f491_u64;
        for _ in 0..400 {
            seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
            let at = (seed >> 33) as usize % (keys.len() + 1);
            let after = at.checked_sub(1).map(|i| keys[i].as_str());
            let before = keys.get(at).map(String::as_str);
            let key = between(after, before).unwrap();
            assert!(valid(&key), "{key}");
            assert!(after.is_none_or(|a| a < key.as_str()), "{after:?} < {key}");
            assert!(
                before.is_none_or(|b| key.as_str() < b),
                "{key} < {before:?}"
            );
            keys.insert(at, key);
        }
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);
    }

    #[test]
    fn the_first_key_is_in_the_middle_and_appending_grows_slowly() {
        assert_eq!(between(None, None).unwrap(), "V");
        let mut last = String::new();
        for _ in 0..60 {
            last = between(
                Some(&last).filter(|k| !k.is_empty()).map(String::as_str),
                None,
            )
            .unwrap();
        }
        assert!(last.len() <= 3, "{last}");
    }

    #[test]
    fn a_full_page_of_appends_or_prepends_fits() {
        let mut appended: Vec<String> = Vec::new();
        let mut prepended: Vec<String> = Vec::new();
        for _ in 0..crate::limits::BLOCKS {
            let key = between(appended.last().map(String::as_str), None).unwrap();
            appended.push(key);
            let key = between(None, prepended.first().map(String::as_str)).unwrap();
            prepended.insert(0, key);
        }
        for keys in [appended, prepended] {
            assert!(keys.windows(2).all(|pair| pair[0] < pair[1]));
            assert!(keys.iter().all(|key| valid(key)));
        }
    }

    #[test]
    fn a_collision_goes_just_after() {
        let key = between(Some("V"), Some("V")).unwrap();
        assert!(key.as_str() > "V" && valid(&key));
    }

    #[test]
    fn spelling() {
        assert!(
            valid("V")
                && valid("a1")
                && !valid("")
                && !valid("a0")
                && !valid("a-")
                && !valid(&"1".repeat(65))
        );
    }
}
