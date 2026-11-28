# Provider screen fixtures

These are minimal reconstructed frames with synthetic content, not seat transcripts.
Codex reproduces the composer, status, shortcut and working rows supplied in the
review of 64f4348e45. Claude models the blank composer and the interrupt behavior
documented in [interactive mode](https://code.claude.com/docs/en/interactive-mode).
Gemini uses the placeholder from the
[upstream composer](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/ui/components/InputPrompt.tsx)
and the boxed composer and progress format shown in
[an upstream capture](https://github.com/google-gemini/gemini-cli/issues/12792).

Rust treats terminal capture as diagnostic. Provider hooks and verified runtime
evidence own operational readiness. These tests exercise the Go diagnostic port only.
