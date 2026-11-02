import { expect, test } from '@playwright/test';
import {
  expectedAdmitted,
  project,
  sortFindings,
  vectors,
  type VectorCase,
} from '../test/question-vectors.js';
import type { QuestionInspection } from '../src/questions.js';

// The browser's own HTML parser is the oracle for every `parser` case; the Rust checker must
// agree with these exact verdicts (extensions/tmt-colab/rust/tmt-colab/tests/page_markup_vectors.rs).
const cases = vectors.cases.filter((candidate) => candidate.scope === 'parser');
const module = '/src/questions.ts';
const results = new Map<string, QuestionInspection>();

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/');
  const inspected = await page.evaluate(
    async ({ module, sources }) => {
      const { inspectQuestions } = await import(module);
      return sources.map((source: string) => inspectQuestions(source));
    },
    { module, sources: cases.map((candidate) => candidate.source.join('\n')) },
  );
  cases.forEach((candidate, index) => results.set(candidate.name, inspected[index]!));
  await page.close();
});

function expected(candidate: VectorCase) {
  return { admitted: expectedAdmitted(candidate), findings: sortFindings(candidate.findings) };
}
for (const candidate of cases)
  test(`${candidate.name}: ${candidate.why}`, () => {
    expect(project(results.get(candidate.name)!)).toEqual(expected(candidate));
  });

// #5891: inspection skips its parse when the source names no question element or marker. Names
// are case-insensitive in HTML, so the same vectors written in capitals inspect the same.
test('the no-question prefilter keeps every vector written in capital letters', async ({
  page,
}) => {
  await page.goto('/');
  const sources = cases.map((candidate) =>
    candidate.source
      .join('\n')
      .replace(
        /<(\/?)tmt-(questions?|review|read)\b/g,
        (_, slash, name) => `<${slash}TMT-${name.toUpperCase()}`,
      )
      .replace(/\bdata-(question|choice)\b/g, (_, name) => `DATA-${name.toUpperCase()}`),
  );
  expect(sources.some((source) => /TMT-QUESTION/.test(source))).toBe(true);
  const inspected: QuestionInspection[] = await page.evaluate(
    async ({ module, sources }) => {
      const { inspectQuestions } = await import(module);
      return sources.map((source: string) => inspectQuestions(source));
    },
    { module, sources },
  );
  cases.forEach((candidate, index) =>
    expect(project(inspected[index]!), candidate.name).toEqual(
      project(results.get(candidate.name)!),
    ),
  );
});
