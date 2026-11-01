//! Remote-owned cloud provider composition; current implementation is Firestore.
pub(crate) mod firestore;

mod port;
pub use port::*;
