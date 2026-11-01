use crate::grammar::{operand, storage};
use clap::{Arg, ArgAction, Command};

fn consent(c: Command) -> Command {
    c.arg(
        Arg::new("yes")
            .long("yes")
            .action(ArgAction::SetTrue)
            .help("Apply the previewed operation without asking"),
    )
}
fn file(c: Command) -> Command {
    c.arg(
        Arg::new("file")
            .long("file")
            .required(true)
            .help("Read a bounded regular JSON definition without following a symlink"),
    )
}

fn selection(c: Command) -> Command {
    c.arg(
        Arg::new("range")
            .long("range")
            .help("Show 1d, 7d or 30d of local calendar slots")
            .value_parser(["1d", "7d", "30d"])
            .default_value("1d"),
    )
    .arg(
        Arg::new("at")
            .long("at")
            .help("Evaluate an RFC3339 instant or local YYYY-MM-DD HH:MM"),
    )
    .arg(
        Arg::new("plan")
            .long("plan")
            .help("Filter the timeline by exact plan name or UUID"),
    )
    .arg(
        Arg::new("member")
            .long("member")
            .help("Filter canonical names case-insensitively, prefix matches first"),
    )
}
pub(in crate::grammar) fn orch() -> Command {
    let jobs=storage(spec!("job","Read and manage agent-owned scheduled messages",["List jobs"=>"tmt orch job ls","Read one job"=>"tmt orch job show j1"]))
        .subcommand_required(true)
        .subcommand(storage(spec!("ls","List jobs, their next slots and recorded outcomes",["List all jobs as JSON"=>"tmt orch job ls --json"])).alias("list")
            .arg(Arg::new("owner").long("owner").help("Filter by an exact current owner name or UUID"))
            .arg(Arg::new("squad-room").long("squad-room").help("Filter by the explicit squad room UUID"))
            .arg(Arg::new("cursor").long("cursor").help("Continue the same filtered page"))
            .arg(Arg::new("limit").long("limit").help("Read 1 through 128 jobs").default_value("50").value_parser(clap::value_parser!(u16).range(1..=128))))
        .subcommand(consent(file(storage(spec!("import","Preview adoption of an exact frozen legacy jobs file",["Preview a frozen source"=>"tmt orch job import --file jobs.json --source-id 11111111-1111-4111-8111-111111111111 --digest aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]))))
            .arg(Arg::new("source-id").long("source-id").required(true).help("Fence this adoption by its exact source UUID"))
            .arg(Arg::new("digest").long("digest").required(true).help("Require the frozen source's exact SHA-256 digest")))
        .subcommand(storage(spec!("import-receipt","Read an accepted adoption without repeating the write",["Recover an exact adoption"=>"tmt orch job import-receipt 11111111-1111-4111-8111-111111111111 --json"])).arg(operand("source-id",true)))
        .subcommand(storage(spec!("show","Read a job and its exact message",["Read a job"=>"tmt orch job show j1 --json"])).arg(operand("job",true)))
        .subcommand(consent(file(storage(spec!("add","Preview and add a job from a definition file",["Preview a new job"=>"tmt orch job add --file job.json"])))))
        .subcommand(consent(file(storage(spec!("edit","Preview replacement of a job definition",["Edit a job"=>"tmt orch job edit j1 --file job.json --yes"])).arg(operand("job",true)))))
        .subcommand(consent(storage(spec!("pause","Manually pause a job until explicitly resumed",["Pause a job"=>"tmt orch job pause j1 --yes"])).arg(operand("job",true))))
        .subcommand(consent(storage(spec!("resume","Explicitly clear a job's manual pause",["Resume a job"=>"tmt orch job resume j1 --yes"])).arg(operand("job",true))))
        .subcommand(consent(storage(spec!("rm","Preview removal without reusing the job ID",["Remove a job"=>"tmt orch job rm j1 --yes"])).arg(operand("job",true))))
        .subcommand(consent(storage(spec!("send","Send a job once without resuming or consuming its held slot",["Send a paused job once"=>"tmt orch job send j1 --yes"]))
            .arg(operand("job",true)).arg(Arg::new("identity").long("identity").help("Attribute the manual send to an existing identity"))
            .arg(Arg::new("operation-id").long("operation-id").help("Reuse only this exact send's operation UUID for receipt recovery"))))
        .subcommand(consent(storage(spec!("reassign","Change the stored owner without implicitly resuming",["Reassign a job"=>"tmt orch job reassign j1 worker-1 --yes"])).arg(operand("job",true)).arg(operand("member-name",true))));
    let add = consent(file(storage(
        spec!("add","Preview a new plan and save only with consent",["Preview a new plan"=>"tmt orch plan add --file plan.json"]),
    )));
    let set=consent(file(storage(spec!("set","Preview replacement of a selected plan",["Replace a plan after preview"=>"tmt orch plan set Quiet --file plan.json --yes"]))).arg(operand("plan-name",true)));
    let remove=consent(storage(spec!("rm","Preview removal of a selected plan",["Preview plan removal"=>"tmt orch plan rm Quiet"])).arg(operand("plan-name",true)));
    let plans = storage(spec!(
        "plan", "Read and change orchestration plans with an effect preview",
        ["List stored plans" => "tmt orch plan ls"]
    ))
    .subcommand_required(true)
    .subcommand(
        storage(spec!(
            "ls", "List stored plans (Base always applies)",
            ["List plans as JSON" => "tmt orch plan ls --json"]
        ))
        .alias("list"),
    )
    .subcommand(
        storage(spec!(
            "show", "Read one plan by UUID or unique exact name",
            ["Read a named plan" => "tmt orch plan show Quiet"]
        ))
        .arg(operand("plan-name", true)),
    )
    .subcommand(add)
    .subcommand(set)
    .subcommand(remove);
    let preview = selection(storage(spec!(
        "preview", "Preview a candidate plan without saving or delivering",
        ["Preview a plan document" => "tmt orch preview --file plan.json"]
    )))
    .arg(
        Arg::new("file")
            .long("file")
            .required(true)
            .help("Read a bounded regular plan JSON file without following a symlink"),
    );
    let why = storage(spec!(
        "why", "Read retained receiving decision facts",
        ["Read a request's recorded decisions" => "tmt orch why req_11111111-1111-4111-8111-111111111111"]
    ))
    .arg(operand("subject", true))
    .arg(
        Arg::new("before")
            .long("before")
            .help("Read event IDs below this cursor")
            .value_parser(clap::value_parser!(u64).range(1..=tmt_core::limits::MAX_JS_SAFE_INTEGER)),
    )
    .arg(
        Arg::new("limit")
            .long("limit")
            .help("Read 1 through 100 journal entries")
            .default_value("50")
            .value_parser(clap::value_parser!(u16).range(1..=100)),
    );
    let page = |c: Command| {
        c.arg(
            Arg::new("member")
                .long("member")
                .help("Filter canonical names case-insensitively, prefix matches first"),
        )
        .arg(
            Arg::new("limit")
                .long("limit")
                .help("Read 1 through 256 rows")
                .value_parser(clap::value_parser!(u16).range(1..=256)),
        )
        .arg(
            Arg::new("after")
                .long("after")
                .help("Continue after the nextAfter cursor of the previous page"),
        )
    };
    let leads = storage(spec!(
        "leads", "Set who counts as a lead for sending rules and talk limits",
        ["Set the leads" => "tmt orch leads set tmt-lead core-lead"]
    ))
    .subcommand_required(true)
    .subcommand(
        consent(storage(spec!(
            "set", "Preview replacing the leads list and save only with consent",
            ["Set two leads" => "tmt orch leads set tmt-lead core-lead --yes", "Clear the leads" => "tmt orch leads set --yes"]
        )))
        .arg(Arg::new("member-name").num_args(0..).help("Lead names; none clears the list")),
    );
    let route = storage(spec!(
        "route", "Allow one route past its sending rule",
        ["Allow once for an hour" => "tmt orch route allow worker-1 reviewer --until 1h"]
    ))
    .subcommand_required(true)
    .subcommand(
        consent(storage(spec!(
            "allow", "Preview allowing FROM to message TO and save only with consent",
            ["Allow until the rule's slot ends" => "tmt orch route allow worker-1 reviewer --yes", "Allow for 30 minutes" => "tmt orch route allow worker-1 reviewer --until 30m --yes"]
        )))
        .arg(operand("from-name", true))
        .arg(operand("to-name", true))
        .arg(
            Arg::new("until")
                .long("until")
                .help("Allow for a ms/s/m/h duration of at most 24 hours (default: until the restricting slot ends)"),
        ),
    );
    let talks = page(storage(spec!(
        "talks", "Read agent pairs with recent or held talk",
        ["List pairs" => "tmt orch talks", "List pairs as JSON" => "tmt orch talks --json"]
    )))
    .subcommand(
        consent(storage(spec!(
            "resume", "Preview releasing a pair's held requests and save only with consent",
            ["Resume a held pair" => "tmt orch talks resume worker-1 worker-2 --yes"]
        )))
        .arg(operand("member-name", true))
        .arg(operand("other-name", true)),
    );
    let routes = page(storage(spec!(
        "routes", "Read the sending verdict for each ordered pair of members",
        ["Read a squad's routes" => "tmt orch routes --member core"]
    )));
    selection(storage(spec!(
        "orch", "Read orchestration slots and effective member policies",
        ["Read the current local day" => "tmt orch", "Inspect a week as JSON" => "tmt orch --range 7d --json"]
    )))
    .subcommand(jobs)
    .subcommand(plans)
    .subcommand(preview)
    .subcommand(why)
    .subcommand(leads)
    .subcommand(route)
    .subcommand(talks)
    .subcommand(routes)
    .subcommand(consent(storage(spec!("focus","Preview personal focus above every plan, or clear it",["Focus for two hours"=>"tmt orch focus worker-1 2h --yes","End focus early"=>"tmt orch focus worker-1 off --yes"])).arg(operand("member-name",true)).arg(operand("focus-duration",true))))
}
