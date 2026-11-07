//! Structured-page blocks (#6004): the block-batch validator, the text merge and the shapes the
//! CLI and the browser both send. Pure values: no Yjs, storage, target lookup or authority.
pub mod merge;
pub mod ops;
pub mod pos;
pub mod schema;
pub mod text;
