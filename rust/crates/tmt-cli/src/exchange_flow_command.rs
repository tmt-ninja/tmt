//! Whole-team read over the request owner's content-free projection.
use crate::output::{Failure, after_cleanup};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::{self, Write},
};
use tmt_adapters::{config::ConfigPaths, request_runtime::wall_time_ms, storage::Storage};
use tmt_core::identity::IdentityReader;
use tmt_core::request::{
    RequestService,
    flow::{self, FlowReport},
};

pub struct Report {
    flow: FlowReport,
    names: BTreeMap<String, String>,
    window_ms: u64,
    bucket_ms: u64,
}

pub fn run(window_ms: u64, bucket_ms: u64, human: bool) -> Result<Report, Failure> {
    let paths = ConfigPaths::discover()
        .map_err(|e| Failure::new("X_ERROR", "Could not read exchange flow.", 1).caused_by(e))?;
    let mut storage = Storage::open(&paths.database).map_err(|e| {
        Failure::storage_access(
            e,
            &paths.global_dir,
            "No exchange flow was changed.",
            "X_ERROR",
            "Could not read exchange flow.",
        )
    })?;
    let result = (|| {
        let mut report = RequestService::new(&mut storage, wall_time_ms)
            .exchange_flow(window_ms)
            .map_err(|e| {
                Failure::new("X_ERROR", "Could not read exchange flow.", 1).caused_by(e)
            })?;
        report.rows = flow::rebucket(report.rows, report.since_ms, window_ms, bucket_ms)
            .ok_or_else(|| {
                Failure::new(
                    "X_ERROR",
                    "Exchange flow totals exceed the safe integer range.",
                    1,
                )
            })?;
        // IdentityReader excludes retired identities. Only the human projection
        // needs current display names; JSON remains a UUID-only aggregate read.
        let names = names_for_human(human, || {
            let names = storage
                .list_identities()
                .map_err(|e| {
                    Failure::new("X_ERROR", "Could not read exchange flow names.", 1).caused_by(e)
                })?
                .into_iter()
                .map(|identity| (identity.id, identity.name))
                .collect::<BTreeMap<_, _>>();
            Ok::<_, Failure>(names)
        })?;
        Ok(Report {
            flow: report,
            names,
            window_ms,
            bucket_ms,
        })
    })();
    after_cleanup(result, || storage.close())
}
fn document(report: &FlowReport, bucket_ms: u64) -> Value {
    json!({"observedAtMs": report.observed_at_ms, "sinceMs": report.since_ms, "bucketMs": bucket_ms,
        "rows": report.rows.iter().map(|row| json!({
            "senderIdentityId": row.sender_identity_id, "recipientIdentityId": row.recipient_identity_id,
            "kind": row.kind.as_str(), "bucketStartMs": row.bucket_start_ms, "count": row.count, "bytes": row.bytes
        })).collect::<Vec<_>>()})
}
fn names_for_human<E>(
    human: bool,
    read: impl FnOnce() -> Result<BTreeMap<String, String>, E>,
) -> Result<BTreeMap<String, String>, E> {
    if human { read() } else { Ok(BTreeMap::new()) }
}

impl tmt_cli_style::Render for Report {
    fn human(
        &self,
        stdout: &mut dyn Write,
        _: &mut dyn Write,
        _: tmt_cli_style::Terminal,
        _: tmt_cli_style::Terminal,
    ) -> io::Result<()> {
        write_human(&mut &mut *stdout, &self.flow, &self.names, self.window_ms)
    }
    fn json(&self, stdout: &mut dyn Write) -> io::Result<()> {
        writeln!(stdout, "{}", document(&self.flow, self.bucket_ms))
    }
}

fn write_human(
    output: &mut impl Write,
    report: &FlowReport,
    names: &BTreeMap<String, String>,
    window_ms: u64,
) -> io::Result<()> {
    let mut totals = BTreeMap::<_, (u64, u64)>::new();
    for row in &report.rows {
        let total = totals
            .entry((
                row.sender_identity_id.clone(),
                row.recipient_identity_id.clone(),
                row.kind,
            ))
            .or_default();
        total.0 = total
            .0
            .checked_add(row.count)
            .ok_or_else(|| io::Error::other("Flow count overflow"))?;
        total.1 = total
            .1
            .checked_add(row.bytes)
            .ok_or_else(|| io::Error::other("Flow bytes overflow"))?;
    }
    writeln!(
        output,
        "Exchange flow since {} ({})",
        utc_minute(report.since_ms)?,
        window_label(window_ms)
    )?;
    tmt_command_output::table::write(
        output,
        ["SENDER", "RECIPIENT", "KIND", "COUNT", "BYTES"],
        totals
            .into_iter()
            .map(|((sender, recipient, kind), (count, bytes))| {
                [
                    participant(sender.as_deref(), names),
                    participant(recipient.as_deref(), names),
                    kind.as_str().into(),
                    count.to_string(),
                    bytes.to_string(),
                ]
            }),
    )?;
    Ok(())
}

fn participant(id: Option<&str>, names: &BTreeMap<String, String>) -> String {
    match id {
        None => "unknown".into(),
        Some(id) => names
            .get(id)
            .cloned()
            .unwrap_or_else(|| tmt_cli_style::value::short_id(id).into()),
    }
}

fn utc_minute(ms: u64) -> io::Result<String> {
    let seconds = i64::try_from(ms / 1_000).map_err(io::Error::other)?;
    let date = time::OffsetDateTime::from_unix_timestamp(seconds).map_err(io::Error::other)?;
    Ok(format!(
        "{:04}-{:02}-{:02} {:02}:{:02} UTC",
        date.year(),
        date.month() as u8,
        date.day(),
        date.hour(),
        date.minute()
    ))
}

fn window_label(ms: u64) -> String {
    for (scale, suffix) in [
        (86_400_000, "d"),
        (3_600_000, "h"),
        (60_000, "m"),
        (1_000, "s"),
    ] {
        // Keep the familiar default 24h, then use days for longer whole days.
        if ms.is_multiple_of(scale) && (suffix != "d" || ms >= 2 * scale) {
            return format!("{}{suffix}", ms / scale);
        }
    }
    format!("{ms}ms")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tmt_core::request::flow::{FlowKind, FlowRow};

    #[test]
    fn json_flow_does_not_read_names() {
        let names = names_for_human(false, || -> Result<BTreeMap<String, String>, ()> {
            panic!("JSON must not read identity names")
        })
        .unwrap();
        assert!(names.is_empty());
        let names = names_for_human(true, || -> Result<BTreeMap<String, String>, ()> {
            Ok(BTreeMap::from([("id".into(), "name".into())]))
        })
        .unwrap();
        assert_eq!(names.get("id").map(String::as_str), Some("name"));
    }

    #[test]
    fn human_flow_names_participants_sums_buckets_and_formats_utc() {
        let id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
        let retired = "11111111-1111-4111-8111-111111111111";
        let since = 1_791_633_600_000; // 2026-10-10 12:00 UTC.
        let mut rows = vec![FlowRow {
            sender_identity_id: Some(id.into()),
            recipient_identity_id: Some(retired.into()),
            kind: FlowKind::Talk,
            bucket_start_ms: since,
            count: 1,
            bytes: 5,
        }];
        rows.push(FlowRow {
            bucket_start_ms: since + flow::BUCKET_MS,
            count: 2,
            bytes: 7,
            ..rows[0].clone()
        });
        rows.push(FlowRow {
            sender_identity_id: None,
            recipient_identity_id: Some(id.into()),
            kind: FlowKind::Reply,
            bucket_start_ms: since,
            count: 1,
            bytes: 9,
        });
        let report = FlowReport {
            observed_at_ms: since + flow::DEFAULT_WINDOW_MS,
            since_ms: since,
            rows,
        };
        let original = document(&report, flow::BUCKET_MS);
        let names = BTreeMap::from([(id.into(), "Ada".into())]);
        let mut output = Vec::new();
        write_human(&mut output, &report, &names, flow::DEFAULT_WINDOW_MS).unwrap();
        assert_eq!(
            String::from_utf8(output).unwrap(),
            "Exchange flow since 2026-10-10 12:00 UTC (24h)\nSENDER   RECIPIENT  KIND   COUNT  BYTES\nunknown  Ada        reply  1      9\nAda      11111111   talk   3      12\n"
        );
        assert_eq!(document(&report, flow::BUCKET_MS), original);
        assert_eq!(original["bucketMs"], flow::BUCKET_MS);
        assert_eq!(
            document(&report, 7 * 86_400_000)["bucketMs"],
            7 * 86_400_000
        );
        assert_eq!(original["rows"][0]["senderIdentityId"], id);
    }
}
