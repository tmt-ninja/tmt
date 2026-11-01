//! Existing Firestore carrier and enrollment implementation, with unchanged effects.
mod carrier;
pub(crate) mod document;
mod pairing;
pub use carrier::Provider;
pub(crate) use carrier::stamp;
pub use pairing::{EnrollmentDocument, EnrollmentProof, InviteGate};
