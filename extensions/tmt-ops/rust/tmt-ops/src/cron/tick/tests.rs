use super::*;

#[test]
fn persisted_squad_slot_identity_survives_the_ops_product_rename() {
    // A pre-rename dispatch receipt's operation UUID, retained across releases.
    assert_eq!(
        operation_id(
            "11111111-1111-4111-8111-111111111111",
            "c1",
            1_700_000_000_000
        ),
        "b17e22b9-5806-8721-984c-36c414c6f81b"
    );
}

#[test]
fn slot_ids_separate_rooms_jobs_and_times_and_are_canonical_uuids() {
    let id = operation_id("room", "c1", 42);
    assert_ne!(id, operation_id("other-room", "c1", 42));
    assert_ne!(id, operation_id("room", "c2", 42));
    assert_ne!(id, operation_id("room", "c1", 43));
    assert_ne!(operation_id("a", "bc", 42), operation_id("ab", "c", 42));
    assert_eq!(id.len(), 36);
    assert_eq!(&id[14..15], "8");
    assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
    assert!(
        id.chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c) || c == '-')
    );
}
