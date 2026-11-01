//! Remote-owned cloud provider composition; current implementation is Firestore.
pub(crate) mod firestore;

mod port;
pub use port::*;

#[cfg(test)]
pub(crate) mod test_support;

/// Production backend admission is selected here, before any Auth token or HTTP.
pub(crate) fn sealed_codec(
    backend: crate::declaration::Backend,
) -> Result<&'static dyn crate::sealed_sync::FieldCodec, crate::sealed_sync::SyncError> {
    match backend {
        crate::declaration::Backend::Firestore => Ok(&firestore::SealedFields),
        _ => Err(crate::sealed_sync::SyncError::Invalid),
    }
}
pub(crate) fn default_fields(
    bytes: &[u8],
) -> Result<serde_json::Map<String, serde_json::Value>, crate::sealed_sync::SyncError> {
    sealed_codec(crate::declaration::Backend::Firestore)?.fields(bytes)
}
