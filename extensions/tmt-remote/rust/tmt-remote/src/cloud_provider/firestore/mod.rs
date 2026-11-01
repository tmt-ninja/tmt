//! Existing Firestore carrier and enrollment implementation, with unchanged effects.
mod carrier;
pub(crate) mod document;
mod pairing;
pub use carrier::Provider;
pub(crate) use carrier::stamp;
pub use pairing::{EnrollmentDocument, EnrollmentProof};

mod port;

mod sealed_fields;
pub(crate) use sealed_fields::SealedFieldsCodec as SealedFields;
