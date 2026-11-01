//! Legacy fixture import; provider document interpretation is adapter-owned.
#[cfg(test)]
pub(crate) use crate::cloud_provider::firestore::document::LegacyCursor as Cursor;
pub(crate) use crate::cloud_provider::firestore::document::*;
