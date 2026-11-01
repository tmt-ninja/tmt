use crate::grammar::{option, storage};
use clap::Command;
pub(in crate::grammar) fn tick() -> Command {
    storage(spec!("tick", "Run jobs, Digest and workspace capture for one finite minute",
        details = "Competing clocks refuse with the current holder. A tick observes sub-minute slots until this minute ends; it does not replay absent-clock history. Ops idle alerts require the Ops worker.",
        ["Run this minute" => "tmt tick", "Keep an explicit foreground clock" => "tmt tick run", "Inspect the clock without starting work" => "tmt tick status"]))
        .subcommand(storage(spec!("run", "Keep the unified clock in this foreground lifetime",
            ["Run until interrupted" => "tmt tick run"])))
        .subcommand(storage(spec!("status", "Read the clock holder without opening storage",
            ["Read clock status as JSON" => "tmt tick status --json"])))
        .subcommand(storage(spec!("timer", "Preview or manage an optional finite user timer",
            details = "Uses user launchd or systemd to invoke finite tmt tick once per minute. Installation and removal require explicit consent. No Ops idle alerts run without the Ops worker.",
            ["Review files without changes" => "tmt tick timer preview --json"]))
            .subcommand(storage(spec!("preview", "Show the exact proposed user timer files", ["Review the plan" => "tmt tick timer preview --json"])))
            .subcommand(storage(spec!("status", "Inspect owned timer files and user manager registration", ["Inspect the timer" => "tmt tick timer status --json"])))
            .subcommand(storage(spec!("install", "Install the exact user timer plan after consent", ["Approve the reviewed plan" => "tmt tick timer install --yes"])).arg(option("yes")))
            .subcommand(storage(spec!("remove", "Stop and remove only unchanged owned user timer files", ["Remove the owned timer" => "tmt tick timer remove --yes"])).arg(option("yes"))))
}
