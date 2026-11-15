//! Fixed suite; key storage and authority remain outside the model.
use crate::{Invalid, Result, framing::frame, require};
use ed25519_dalek::{Signature, VerifyingKey};
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, sync::Mutex};

pub fn digest(input: &[u8]) -> [u8; 32] {
    Sha256::digest(input).into()
}
pub fn public_key(raw: &[u8]) -> Result<VerifyingKey> {
    let bytes = raw.try_into().map_err(|_| Invalid)?;
    let key = VerifyingKey::from_bytes(bytes).map_err(|_| Invalid)?;
    require(!key.is_weak() && key.to_edwards().compress().as_bytes() == bytes)?;
    Ok(key)
}
pub fn verify_signature(key: &[u8], input: &[u8], signature: &[u8]) -> Result<()> {
    verify_with(&public_key(key)?, input, signature)
}
/// Signatures this process has verified, by `verified_key`: at most `VERIFIED_LIMIT`.
///
/// A snapshot verifies the space's whole owner log, and a page read, a list or one attachment chunk
/// each takes a snapshot, so one process used to verify the same few hundred signatures tens of
/// times over (#6450). `verify_strict` is a pure function of the key, input and signature bytes, so
/// a success for those exact bytes is a success again: the cache answers only that, for a key that
/// already passed `public_key`. Only successes are kept; a failure is verified again every time.
/// Every caller still runs every other check. The cache lives in this process's memory only (never
/// stored or shared), and nothing a peer sends enters it except a signature that verifies.
static VERIFIED: Mutex<Option<HashSet<[u8; 32]>>> = Mutex::new(None);
const VERIFIED_LIMIT: usize = 16_384;
/// The cache key: SHA-256 over a domain tag and the length-framed exact public key, input and
/// signature bytes, so no two different triples share one.
fn verified_key(key: &VerifyingKey, input: &[u8], signature: &[u8]) -> Result<[u8; 32]> {
    Ok(digest(&frame(&[
        b"tmt-colab-verified-signature-v1",
        key.as_bytes(),
        input,
        signature,
    ])?))
}
/// `verify_signature` with a key already checked by `public_key`, for a caller that verifies many
/// signatures of one key.
pub fn verify_with(key: &VerifyingKey, input: &[u8], signature: &[u8]) -> Result<()> {
    let cached = verified_key(key, input, signature)?;
    let verified =
        |set: &Option<HashSet<[u8; 32]>>| set.as_ref().is_some_and(|set| set.contains(&cached));
    if verified(
        &VERIFIED
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
    ) {
        return Ok(());
    }
    let parsed = Signature::from_slice(signature).map_err(|_| Invalid)?;
    key.verify_strict(input, &parsed).map_err(|_| Invalid)?;
    let mut set = VERIFIED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let set = set.get_or_insert_with(HashSet::new);
    if set.len() >= VERIFIED_LIMIT {
        set.clear();
    }
    set.insert(cached);
    Ok(())
}
pub fn mac(key: &[u8], input: &[u8]) -> [u8; 32] {
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key length");
    m.update(input);
    m.finalize().into_bytes().into()
}
pub fn verify_mac(key: &[u8], input: &[u8], tag: &[u8]) -> Result<()> {
    require(tag.len() == 32)?;
    let mut m = Hmac::<Sha256>::new_from_slice(key).map_err(|_| Invalid)?;
    m.update(input);
    m.verify_slice(tag).map_err(|_| Invalid)
}
/// RFC5869 extract and one-block expand for the contract's 32-byte outputs.
pub fn derive_key(secret: &[u8], salt: &[u8], info: &[u8]) -> [u8; 32] {
    let prk = mac(salt, secret);
    let mut block = info.to_vec();
    block.push(1);
    mac(&prk, &block)
}
pub fn space_id(owner: &[u8; 32]) -> Result<String> {
    public_key(owner)?;
    let hash = digest(&frame(&[b"tmt-colab-space-id-v1", owner])?);
    let alphabet = b"abcdefghijklmnopqrstuvwxyz234567";
    let mut out = String::with_capacity(32);
    for i in 0..32 {
        let bit = i * 5;
        let byte = bit / 8;
        let shift = bit % 8;
        let word = ((hash[byte] as u16) << 8) | hash[byte + 1] as u16;
        out.push(alphabet[((word >> (11 - shift)) & 31) as usize] as char);
    }
    Ok(out)
}
#[cfg(test)]
mod verified_tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn a_kept_success_never_answers_for_other_bytes() {
        let signer = SigningKey::from_bytes(&[7; 32]);
        let key = signer.verifying_key();
        let signature = signer.sign(b"statement").to_bytes();
        // Verified twice: the second answer comes from the cache.
        verify_signature(key.as_bytes(), b"statement", &signature).unwrap();
        verify_signature(key.as_bytes(), b"statement", &signature).unwrap();
        // Any other input, signature or key is verified, and fails, every time.
        let mut forged = signature;
        forged[0] ^= 1;
        let other = SigningKey::from_bytes(&[8; 32]).verifying_key();
        for _ in 0..2 {
            assert!(verify_signature(key.as_bytes(), b"statement!", &signature).is_err());
            assert!(verify_signature(key.as_bytes(), b"statement", &forged).is_err());
            assert!(verify_signature(other.as_bytes(), b"statement", &signature).is_err());
        }
    }
}
