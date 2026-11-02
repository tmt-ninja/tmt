// Lints every tmt-remote target with the default-off emulator feature for the Native Rust
// clippy job (#5003). Ordinary workspace Clippy never enables it, so a stale caller in a
// feature-gated test compiled nowhere in hosted CI. Remote's test_emulator_guard forbids the
// feature anywhere under `.github/`, so the workflow calls this script instead of spelling it.
// Compile only: no emulator, credential or account.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REMOTE_EMULATOR_LINT = [
  'cargo',
  'clippy',
  '--locked',
  '-p',
  'tmt-remote',
  '--all-targets',
  '--features',
  'test-emulator',
  '--',
  '-D',
  'warnings',
];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = REMOTE_EMULATOR_LINT;
  process.stdout.write(`$ ${REMOTE_EMULATOR_LINT.join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd: fileURLToPath(new URL('../../rust/', import.meta.url)),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
