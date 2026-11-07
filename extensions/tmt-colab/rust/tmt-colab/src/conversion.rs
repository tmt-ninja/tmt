//! Revision-fenced conversion of an HTML page, with a recoverable archived copy.
//!
//! The backend owns admission, publication and durable operation receipts. This module owns the
//! order: the original may be changed only after its archived copy has been verified.
use sha2::{Digest, Sha256};

/// The immutable original state read under the caller's admitted page access.
pub struct Original {
    pub space: String,
    pub page: String,
    pub revision: String,
    pub title: String,
    pub source: String,
    pub layout: Option<crate::decoder::PageLayout>,
    pub template: bool,
    pub converted_from: Option<String>,
    pub structured: bool,
}

/// The state actually read back from the candidate archive copy.
pub struct CopyState {
    pub title: String,
    pub source: String,
    pub layout: Option<crate::decoder::PageLayout>,
    pub archived: bool,
    pub converted_label: bool,
}

/// The publication owner supplies durable, idempotent operations for one admitted caller.
pub trait Backend {
    type Error;
    fn original(&mut self) -> Result<Original, Self::Error>;
    /// Create if absent; an existing ID must not be overwritten or adopted without verification.
    fn create_copy(
        &mut self,
        id: &str,
        title: &str,
        source: &str,
        layout: Option<&crate::decoder::PageLayout>,
    ) -> Result<(), Self::Error>;
    fn label_copy(&mut self, id: &str) -> Result<(), Self::Error>;
    fn archive_copy(&mut self, id: &str) -> Result<(), Self::Error>;
    fn read_copy(&mut self, id: &str) -> Result<CopyState, Self::Error>;
    /// Atomically replace only this exact original revision and record the copy ID.
    fn convert(&mut self, revision: &str, copy_id: &str) -> Result<(), Self::Error>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum Error<E> {
    Backend(E),
    AlreadyStructured,
    Template,
    TitleTooLong,
    CopyMismatch,
}

/// The decoder's expected projection for the single conversion action. Admission and the
/// revision fence are owned by the structured publication path, not this pure transformation.
pub(crate) fn project(
    base: &serde_json::Value,
    body: &serde_json::Value,
) -> Result<serde_json::Value, crate::decoder::DecodeFault> {
    use crate::decoder::DecodeFault;
    let body = body.as_object().ok_or(DecodeFault::InvalidInput)?;
    let copy_id = body
        .get("copyId")
        .and_then(serde_json::Value::as_str)
        .filter(|id| tmt_colab_model::values::generated_id(id).is_ok())
        .filter(|_| body.len() == 1)
        .ok_or(DecodeFault::InvalidInput)?;
    let meta = base
        .get("meta")
        .and_then(serde_json::Value::as_object)
        .ok_or(DecodeFault::InvalidInput)?;
    if meta.contains_key("pageType") || meta.contains_key("template") {
        return Err(DecodeFault::InvalidInput);
    }
    let mut next = base.clone();
    next["html"] = serde_json::json!("");
    next["blocks"] = serde_json::json!({});
    let meta = next["meta"]
        .as_object_mut()
        .ok_or(DecodeFault::InvalidInput)?;
    meta.remove("layout");
    meta.remove("layoutReason");
    meta.insert("pageType".into(), serde_json::json!("blocks"));
    meta.insert("convertedFrom".into(), serde_json::json!(copy_id));
    Ok(next)
}

/// A revision determines its own copy, including after an interrupted create or archive.
pub fn copy_id(space: &str, page: &str, revision: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(b"tmt-colab/structured-conversion-copy/v1\0");
    for part in [space, page, revision] {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    let mut bytes: [u8; 16] = hash.finalize()[..16].try_into().expect("digest length");
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

/// Preserve and verify the copy before changing the original. A committed retry returns its ID.
pub fn convert<B: Backend>(backend: &mut B) -> Result<String, Error<B::Error>> {
    let original = backend.original().map_err(Error::Backend)?;
    if original.structured {
        return original.converted_from.ok_or(Error::AlreadyStructured);
    }
    if original.template {
        return Err(Error::Template);
    }
    let title = format!("{} (before conversion)", original.title);
    if title.len() > crate::decoder::BASELINE_TITLE_BYTES {
        return Err(Error::TitleTooLong);
    }
    let id = copy_id(&original.space, &original.page, &original.revision);
    backend
        .create_copy(&id, &title, &original.source, original.layout.as_ref())
        .map_err(Error::Backend)?;
    // Verify identity and exact source before changing even the candidate's labels or state.
    let copy = backend.read_copy(&id).map_err(Error::Backend)?;
    if copy.title != title
        || copy.source.as_bytes() != original.source.as_bytes()
        || copy.layout != original.layout
    {
        return Err(Error::CopyMismatch);
    }
    if !copy.converted_label {
        backend.label_copy(&id).map_err(Error::Backend)?;
    }
    if !copy.archived {
        backend.archive_copy(&id).map_err(Error::Backend)?;
    }
    let copy = backend.read_copy(&id).map_err(Error::Backend)?;
    if !copy.archived
        || !copy.converted_label
        || copy.title != title
        || copy.source.as_bytes() != original.source.as_bytes()
        || copy.layout != original.layout
    {
        return Err(Error::CopyMismatch);
    }
    backend
        .convert(&original.revision, &id)
        .map_err(Error::Backend)?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Fixture {
        failure: Option<&'static str>,
        copy: Option<CopyState>,
        original_changed: bool,
        revision_changed: bool,
        creates: usize,
        reads: usize,
        corrupt: bool,
        corrupt_after: bool,
        title: Option<String>,
        template: bool,
    }

    impl Fixture {
        fn step(&self, name: &'static str) -> Result<(), &'static str> {
            if self.failure == Some(name) {
                Err(name)
            } else {
                Ok(())
            }
        }
    }

    impl Backend for Fixture {
        type Error = &'static str;
        fn original(&mut self) -> Result<Original, Self::Error> {
            self.step("original")?;
            Ok(Original {
                space: "space".into(),
                page: "page".into(),
                revision: "revision".into(),
                title: self.title.clone().unwrap_or_else(|| "Notes".into()),
                source: "<p>α &amp; β</p>\n".into(),
                layout: Some(crate::decoder::PageLayout {
                    kind: crate::decoder::LayoutKind::Column,
                    reason: None,
                }),
                template: self.template,
                converted_from: self
                    .original_changed
                    .then(|| copy_id("space", "page", "revision")),
                structured: self.original_changed,
            })
        }
        fn create_copy(
            &mut self,
            _id: &str,
            title: &str,
            source: &str,
            layout: Option<&crate::decoder::PageLayout>,
        ) -> Result<(), Self::Error> {
            self.step("create")?;
            if self.copy.is_none() {
                self.creates += 1;
                self.copy = Some(CopyState {
                    title: title.into(),
                    source: source.into(),
                    layout: layout.cloned(),
                    archived: false,
                    converted_label: false,
                });
            }
            Ok(())
        }
        fn label_copy(&mut self, _id: &str) -> Result<(), Self::Error> {
            self.step("label")?;
            self.copy.as_mut().unwrap().converted_label = true;
            Ok(())
        }
        fn archive_copy(&mut self, _id: &str) -> Result<(), Self::Error> {
            self.step("archive")?;
            self.copy.as_mut().unwrap().archived = true;
            Ok(())
        }
        fn read_copy(&mut self, _id: &str) -> Result<CopyState, Self::Error> {
            self.reads += 1;
            self.step(if self.reads == 1 {
                "read-before"
            } else {
                "read-after"
            })?;
            let copy = self.copy.as_ref().unwrap();
            Ok(CopyState {
                title: copy.title.clone(),
                source: if self.corrupt || (self.corrupt_after && self.reads > 1) {
                    "different".into()
                } else {
                    copy.source.clone()
                },
                layout: copy.layout.clone(),
                archived: copy.archived,
                converted_label: copy.converted_label,
            })
        }
        fn convert(&mut self, revision: &str, _copy_id: &str) -> Result<(), Self::Error> {
            self.step("convert")?;
            if self.revision_changed || revision != "revision" {
                return Err("stale");
            }
            self.original_changed = true;
            Ok(())
        }
    }

    #[test]
    fn retries_after_each_failure_without_replacing_the_original_or_copy() {
        for step in [
            "original",
            "create",
            "read-before",
            "label",
            "archive",
            "read-after",
            "convert",
        ] {
            let mut fixture = Fixture {
                failure: Some(step),
                ..Fixture::default()
            };
            assert_eq!(convert(&mut fixture), Err(Error::Backend(step)), "{step}");
            assert!(!fixture.original_changed, "{step}");
            fixture.failure = None;
            fixture.reads = 0;
            let id = convert(&mut fixture).unwrap();
            assert_eq!(id, copy_id("space", "page", "revision"));
            assert_eq!(fixture.creates, 1, "{step}");
            assert!(fixture.original_changed);
            assert_eq!(convert(&mut fixture).unwrap(), id);
            assert_eq!(fixture.creates, 1);
        }
    }

    #[test]
    fn refuses_a_wrong_copy_and_a_changed_original() {
        let mut fixture = Fixture {
            corrupt: true,
            ..Fixture::default()
        };
        assert_eq!(convert(&mut fixture), Err(Error::CopyMismatch));
        assert!(!fixture.original_changed);
        let mut fixture = Fixture {
            corrupt_after: true,
            ..Fixture::default()
        };
        assert_eq!(convert(&mut fixture), Err(Error::CopyMismatch));
        assert!(!fixture.original_changed);
        assert!(fixture.copy.unwrap().archived);
        let mut fixture = Fixture {
            revision_changed: true,
            ..Fixture::default()
        };
        assert_eq!(convert(&mut fixture), Err(Error::Backend("stale")));
        assert!(!fixture.original_changed);
        assert!(fixture.copy.unwrap().archived);
    }

    #[test]
    fn refuses_an_overlong_archive_title_before_creating_a_copy() {
        let mut fixture = Fixture {
            title: Some("x".repeat(crate::decoder::BASELINE_TITLE_BYTES)),
            ..Fixture::default()
        };
        assert_eq!(convert(&mut fixture), Err(Error::TitleTooLong));
        assert_eq!(fixture.creates, 0);
        assert!(!fixture.original_changed);
    }

    #[test]
    fn refuses_a_template_before_creating_a_copy() {
        let mut fixture = Fixture {
            template: true,
            ..Fixture::default()
        };
        assert_eq!(convert(&mut fixture), Err(Error::Template));
        assert_eq!(fixture.creates, 0);
        assert!(!fixture.original_changed);
    }

    #[test]
    fn identifiers_are_stable_and_bound_to_the_revision() {
        let id = copy_id("space", "page", "one");
        assert_eq!(id, copy_id("space", "page", "one"));
        assert_ne!(id, copy_id("space", "page", "two"));
        tmt_colab_model::values::generated_id(&id).unwrap();
    }

    #[test]
    fn projection_preserves_content_metadata_but_drops_the_old_layout() {
        let id = "10000000-0000-4000-8000-000000000001";
        let base = serde_json::json!({"html":"<p>old</p>","meta":{
            "title":"Page", "layout":"canvas", "layoutReason":"Custom canvas",
            "work":{"version":2,"order":[]}, "attachments":[], "fromTemplate":{"name":"a"}
        }});
        let next = project(&base, &serde_json::json!({"copyId":id})).unwrap();
        assert_eq!(next["html"], "");
        assert_eq!(next["blocks"], serde_json::json!({}));
        assert_eq!(next["meta"]["convertedFrom"], id);
        assert_eq!(next["meta"]["pageType"], "blocks");
        for key in ["title", "work", "attachments", "fromTemplate"] {
            assert_eq!(next["meta"][key], base["meta"][key], "{key}");
        }
        assert!(next["meta"].get("layout").is_none());
        assert!(next["meta"].get("layoutReason").is_none());
        let mut template = base.clone();
        template["meta"]["template"] = serde_json::json!({});
        assert!(project(&template, &serde_json::json!({"copyId":id})).is_err());
        assert!(project(&base, &serde_json::json!({"copyId":"bad"})).is_err());
        assert!(project(&base, &serde_json::json!({"copyId":id,"extra":1})).is_err());
        assert!(project(&next, &serde_json::json!({"copyId":id})).is_err());
    }
}
