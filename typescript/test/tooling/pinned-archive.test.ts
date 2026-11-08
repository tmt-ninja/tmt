import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';

// Pinned release archives (nextest, wasm-bindgen) go through one action: a digest-keyed cache
// stands in for the download, a miss retries within bounds, and the sha256 check runs on every
// path before the cache is written or the tool is used (#6212).
const root = new URL('../../../', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');

const action = read('.github/actions/fetch-pinned-archive/action.yml');

function step(source: string, name: string): string {
  const start = source.indexOf(`    - name: ${name}\n`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n    - ', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe('fetch-pinned-archive', () => {
  it('restores by digest, downloads only on a miss, then checks, then saves', () => {
    const restore = step(action, 'Restore the pinned archive');
    const download = step(action, 'Download the pinned archive');
    const check = step(action, 'Check the pinned digest');
    const save = step(action, 'Save the pinned archive on main only');
    const order = [restore, download, check, save].map((body) => action.indexOf(body));
    expect(order, 'restore, download, check, save in that order').toEqual(
      [...order].sort((a, b) => a - b)
    );
    expect(new Set(order).size).toBe(4);
    expect(action.match(/^ {4}- name: /gm), 'no other step').toHaveLength(4);

    expect(restore).toContain('uses: actions/cache/restore@v4');
    expect(restore).toContain("SEGMENT_DOWNLOAD_TIMEOUT_MINS: '2'");
    expect(restore).toContain('path: ${{ inputs.path }}');
    // The digest is part of the key, so another digest never hits this entry.
    expect(restore).toMatch(
      /key: pinned-archive-\$\{\{ inputs\.name \}\}-\$\{\{ inputs\.sha256 \}\}/
    );
    expect(restore).not.toContain('restore-keys');

    expect(download).toContain("if: steps.cache.outputs.cache-hit != 'true'");
    for (const flag of [
      '--fail',
      '--location',
      '--connect-timeout 10',
      '--max-time 60',
      '--retry 3',
      '--retry-all-errors',
      '--retry-delay 5',
      '--retry-max-time 150',
    ]) {
      expect(download, flag).toContain(flag);
    }

    expect(save).toContain(
      "if: github.ref == 'refs/heads/main' && steps.cache.outputs.cache-hit != 'true'"
    );
    expect(save).toContain('uses: actions/cache/save@v4');
    expect(save).toContain('key: ${{ steps.cache.outputs.cache-primary-key }}');
  });

  it('checks the exact digest on every path and never softens a failure', () => {
    const check = step(action, 'Check the pinned digest');
    expect(check).not.toMatch(/^\s+if:/m);
    expect(check).toContain('SHA256: ${{ inputs.sha256 }}');
    expect(check).toContain('set -euo pipefail');
    expect(check).toContain(`printf '%s  %s\\n' "$SHA256" "$ARCHIVE" | sha256sum --check`);
    expect(action).not.toContain('continue-on-error');
    expect(action).not.toContain('sha256sum --ignore-missing');
    expect(action).not.toContain('--insecure');
    expect(action).not.toMatch(/curl[^\n]*\s-k\b/);
  });
});

describe('pinned tool callers', () => {
  const pins = [
    {
      file: '.github/actions/setup-nextest/action.yml',
      name: 'cargo-nextest-0.9.148-x86_64-unknown-linux-gnu',
      url: 'https://github.com/nextest-rs/nextest/releases/download/cargo-nextest-0.9.148/cargo-nextest-0.9.148-x86_64-unknown-linux-gnu.tar.gz',
      sha256: '223ba936714cc861a9cdedad5a8eb664dfdd69d6fbdf6cea6aa8184f523290dc',
      path: '${{ runner.temp }}/nextest-tool/tool.tar.gz',
    },
    {
      file: '.github/workflows/ci.yml',
      name: 'wasm-bindgen-0.2.128-x86_64-unknown-linux-musl',
      url: 'https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.128/wasm-bindgen-0.2.128-x86_64-unknown-linux-musl.tar.gz',
      sha256: 'b51f0208fdff83515a787bd8ab9ac5865ed84dabb66d0c709957bb59793c645f',
      path: '${{ runner.temp }}/wasm-bindgen.tar.gz',
    },
  ];

  for (const pin of pins) {
    it(`${pin.name} keeps its pinned digest and uses the shared action`, () => {
      const source = read(pin.file);
      const uses = source.match(/uses: \.\/\.github\/actions\/fetch-pinned-archive/g);
      expect(uses, 'one call').toHaveLength(1);
      const at = source.indexOf('uses: ./.github/actions/fetch-pinned-archive');
      const call = source.slice(at, source.indexOf('\n      - ', at));
      expect(call).toContain(`name: ${pin.name}`);
      expect(call).toContain(`url: ${pin.url}`);
      expect(call).toContain(`sha256: ${pin.sha256}`);
      expect(call).toContain(`path: ${pin.path}`);
      // The name carries the version that the URL downloads.
      expect(pin.url.endsWith(`/${pin.name}.tar.gz`)).toBe(true);
      // The caller no longer downloads or checks: the archive it extracts was checked by the action.
      expect(source).not.toMatch(/curl[^\n]*releases\/download/);
      expect(source).not.toContain('sha256sum');
    });
  }

  it('lets no workflow or action fetch a release asset except through the shared action', () => {
    const files = (readdirSync(new URL('.github/', root), { recursive: true }) as string[])
      .filter((file) => /\.ya?ml$/.test(file))
      .map((file) => `.github/${file}`);
    const direct: string[] = [];
    for (const file of files) {
      for (const [index, line] of read(file).split('\n').entries()) {
        if (!line.includes('releases/download')) continue;
        if (!/^\s+url: https:\/\//.test(line)) direct.push(`${file}:${index + 1}`);
      }
    }
    expect(direct).toEqual([]);
  });
});
