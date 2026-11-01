use crate::grammar::storage;
use clap::Command;
pub(in crate::grammar) fn tick() -> Command {
    storage(spec!("tick", "Run jobs, Digest and workspace capture for one finite minute",
        details = "Competing clocks refuse with the current holder. A tick observes sub-minute slots until this minute ends; it does not replay absent-clock history. Ops idle alerts require the Ops worker.",
        ["Run this minute" => "tmt tick", "Keep an explicit foreground clock" => "tmt tick run", "Inspect the clock without starting work" => "tmt tick status"]))
        .subcommand(storage(spec!("run", "Keep the unified clock in this foreground lifetime",
            ["Run until interrupted" => "tmt tick run"])))
        .subcommand(storage(spec!("status", "Read the clock holder without opening storage",
            ["Read clock status as JSON" => "tmt tick status --json"])))
}
