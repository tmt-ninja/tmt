# Go replacement backlog

This inventory tracks adapter work that remains before replacing native Core.
The experiment continues to use the isolated Go binary and home during development.
See [#6938](https://github.com/tmt-ninja/tmt/issues/6938) for the delivery order.

- [ ] Finish local API v1 operation admission, response parity, lazy schema fencing,
  lifecycle delivery, and CLI composition. Qualify MCP identity pinning and all
  eight tool calls against real Go request services.
- [ ] Finish Digest checklist read, claim, delivery and settle, receiving sync,
  consumption limits and changes, and the shared wake clock. Port the finite and
  foreground tick clock, job and capture composition, and consented timer commands.
- [ ] Prove resolved child execution and callbacks against a real Rust companion
  using the Go home. Port lifecycle-hook enable, disable and delivery with
  executable verification and bounded context contributions.
- [ ] Complete orchestration reads and CLI commands, including the Why journal,
  then workspace capture and restore; port the external-command dispatch markers
  currently marked unported in the dispatch adapter.
- [ ] Port Go guide reference topics in native order. Complete setup, owned skill
  registry and provider integration that are currently unported in the managed
  skills adapter. Keep Go launch guidance on its isolated binary and home.
- [ ] Finish installation and upgrade parity and the consented Go uninstall.
  Its experiment scope is the Go executable and Go home.
