//! Colab's plain hosted tree uses the existing archive, publication and receipt owners.
//! This admits paths only; Colab and Remote own serving metadata and content semantics.
use super::{Product, invalid};
use std::{collections::BTreeSet, io};
pub(super) const PATH_BYTES: usize = 1024 + "dist-hosted".len();
pub(super) const RECEIPT_EXTRA: usize =
    super::artifact::MAX_ARCHIVE_ENTRIES * (PATH_BYTES + 64 + 16);
pub(super) fn is_file(product: Product, path: &str) -> bool {
    product.hosted_tree().is_some_and(|root| {
        path.strip_prefix(root)
            .is_some_and(|rest| rest.starts_with('/') && rest.len() > 1)
    })
}
pub(super) fn validate<'a>(
    product: Product,
    paths: impl IntoIterator<Item = &'a str>,
) -> io::Result<()> {
    let paths: BTreeSet<_> = paths.into_iter().collect();
    if paths.is_empty() {
        return Ok(());
    }
    let root = product
        .hosted_tree()
        .ok_or_else(|| invalid("This product carries no hosted tree."))?;
    for path in &paths {
        let relative = path
            .strip_prefix(root)
            .and_then(|p| p.strip_prefix('/'))
            .ok_or_else(|| invalid("Unexpected hosted archive path."))?;
        if path.len() > PATH_BYTES
            || relative.split('/').any(|part| {
                part.is_empty()
                    || part.starts_with('.')
                    || !part
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            })
        {
            return Err(invalid("Unexpected hosted archive path."));
        }
        if paths.iter().any(|other| {
            other
                .strip_prefix(path)
                .is_some_and(|rest| rest.starts_with('/'))
        }) {
            return Err(invalid("Conflicting hosted archive paths."));
        }
    }
    for required in ["index.html", "THIRD-PARTY-NOTICES.txt"] {
        if !paths.contains(format!("{root}/{required}").as_str()) {
            return Err(invalid("Hosted archive entry or notices are missing."));
        }
    }
    Ok(())
}
