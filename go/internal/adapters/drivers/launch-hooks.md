# Invocation-only provider hooks

| Provider | Per-launch mechanism | Status |
| --- | --- | --- |
| Claude | `--settings` with inline JSON | The driver adds the native activity events when its caller supplies the absolute `tmt-go` callback. Passing existing inline settings preserves their definitions. The driver refuses settings file arguments for this opt-in because it does not read provider settings. [Claude settings](https://code.claude.com/docs/en/settings#change-a-setting-for-one-session) |
| Codex | `-c hooks=…` with inline TOML | Rust first checks the effective hook sources to avoid shadowing inline arrays and duplicating definitions. The Go driver needs a way to qualify those sources within the experiment's isolation rules. Provider hook trust remains user-controlled. [Rust composition](../../../../rust/crates/tmt-adapters/src/drivers/codex/digest.rs) |
| Gemini | Environment-selected JSON system defaults or system settings | The documented path overrides replace an existing configuration source. An additive launch-only hook source has not been qualified, so the driver uses its basic launch. [Gemini configuration](https://geminicli.com/docs/reference/configuration/#settings-files) |

The launch command does not grant a hook permission to update a binding. The
Go CLI callback must verify the exact binding and process before applying activity.
