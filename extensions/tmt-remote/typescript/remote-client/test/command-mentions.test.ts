import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';
import { commandMentions } from '../src/command-mentions.js';

const fixtures = JSON.parse(
  readFileSync(
    new URL(
      '../../../../tmt-ops/rust/tmt-ops/src/board/member_links/command-fixtures.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Array<{ name: string; source: string; mentions: unknown[] }>;

for (const { name, source, mentions } of fixtures) {
  test(name, () => {
    const offset = (at: number) => Buffer.byteLength(source.slice(0, at));
    expect(
      commandMentions(source).map(({ range, content, command }) => ({
        range: range.map(offset),
        content: content.map(offset),
        command,
      })),
    ).toEqual(mentions);
  });
}
