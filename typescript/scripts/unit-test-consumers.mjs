/** Retained tooling projects share one source inventory and evidence verifier. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHELL_TEST = 'test/tooling/onboarding.test.ts';
export const UNIT_CONSUMER_NAMES = {
  tooling: 'Retained tooling tests',
  shell: 'Shell onboarding contracts',
  rules: 'Selected Rules suites',
};
export function toolingGroup(file) {
  assert(
    /^test\/tooling\/(?:[\w.-]+\/)*[\w.-]+\.test\.ts$/.test(file),
    `Not a tooling test: ${file}`
  );
  return file === SHELL_TEST ? 'shell' : 'tooling';
}
export function readToolingGroups(cwd) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(join(cwd, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      assert(!entry.isSymbolicLink(), `Tooling discovery refuses a symlink: ${file}`);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && file.endsWith('.test.ts')) files.push(file);
    }
  }
  visit('test/tooling');
  const result = { tooling: [], shell: [] };
  for (const file of files.sort()) result[toolingGroup(file)].push(file);
  assert(result.tooling.length > 0 && result.shell.length > 0, 'Empty tooling project discovery.');
  return result;
}

function fileName(name, cwd) {
  assert.equal(typeof name, 'string', 'Missing test file identity.');
  const file = (isAbsolute(name) ? relative(cwd, name) : name).split(sep).join('/');
  toolingGroup(file);
  return file;
}
const sorted = (rows) => rows.map((row) => JSON.stringify(row)).sort();
function equal(actual, expected, label) {
  if (JSON.stringify(sorted(actual)) !== JSON.stringify(sorted(expected))) throw new Error(label);
}
export function createUnitPlan(discovery, cwd) {
  assert(Array.isArray(discovery) && discovery.length > 0, 'Empty unit test discovery.');
  const files = readToolingGroups(cwd);
  const tests = discovery.map((test) => {
    assert(typeof test.name === 'string' && test.name.length > 0, 'Missing discovered test name.');
    const file = fileName(test.file, cwd);
    assert(files[toolingGroup(file)].includes(file), `Undeclared test file: ${file}`);
    assert(['run', 'skip', 'todo'].includes(test.mode), `Unsupported test mode: ${test.name}`);
    return [file, test.name, test.mode === 'run' ? 'passed' : 'skipped'];
  });
  return { files, tests };
}
export function checkUnitResults(results, remoteRules, colabRules) {
  equal(Object.keys(results), ['tooling', 'shell', 'rules'], 'Unexpected unit consumer inventory.');
  assert(
    ['true', 'false'].includes(remoteRules) && ['true', 'false'].includes(colabRules),
    'Missing Rules selection.'
  );
  assert.equal(results.tooling, 'success', 'Selected tooling consumer did not succeed.');
  assert.equal(results.shell, 'success', 'Selected shell consumer did not succeed.');
  assert.equal(
    results.rules,
    remoteRules === 'true' || colabRules === 'true' ? 'success' : 'skipped',
    'Rules consumer does not match its selection.'
  );
}
function readJson(file) {
  assert(statSync(file).size <= 16 * 1024 * 1024, `Unit report exceeds 16 MiB: ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function verifyUnitReports(plan, consumers, { cwd, sha, runId }) {
  assert(/^[a-f0-9]{40}$/.test(sha ?? ''), 'Missing exact unit head.');
  assert(/^\d+$/.test(runId ?? ''), 'Missing unit workflow run.');
  assert(Array.isArray(plan.tests) && plan.tests.length > 0, 'Missing unit discovery plan.');
  equal(Object.keys(consumers), ['tooling', 'shell'], 'Missing or extra test consumers.');
  const actualFiles = [],
    passed = [],
    skipped = [];
  for (const group of ['tooling', 'shell']) {
    const { context, report } = consumers[group];
    assert.equal(context.consumer, group, 'Wrong unit report consumer.');
    assert.equal(context.sha, sha, 'Unit report belongs to another head.');
    assert.equal(context.runId, runId, 'Unit report belongs to another workflow run.');
    assert.equal(report.success, true, `${group} test execution failed.`);
    assert(
      Array.isArray(report.testResults) && report.testResults.length > 0,
      `Empty ${group} report.`
    );
    const files = [];
    for (const result of report.testResults) {
      const file = fileName(result.name, cwd);
      assert.equal(toolingGroup(file), group, `Wrong consumer for ${file}`);
      assert(!actualFiles.includes(file), `Duplicate test file: ${file}`);
      actualFiles.push(file);
      files.push(file);
      assert(
        Array.isArray(result.assertionResults) && result.assertionResults.length > 0,
        `Empty test file: ${file}`
      );
      for (const test of result.assertionResults) {
        assert(
          typeof test.title === 'string' &&
            test.title.length > 0 &&
            Array.isArray(test.ancestorTitles) &&
            test.ancestorTitles.every((title) => typeof title === 'string'),
          'Missing executed test identity.'
        );
        assert(
          ['passed', 'skipped', 'pending', 'todo', 'disabled'].includes(test.status),
          `Unsuccessful test: ${test.title}`
        );
        (test.status === 'passed' ? passed : skipped).push([
          file,
          [...test.ancestorTitles, test.title].join(' > '),
          test.status === 'passed' ? 'passed' : 'skipped',
        ]);
      }
    }
    equal(files, plan.files[group], `Missing or extra ${group} test files.`);
  }
  equal(
    [...passed, ...skipped],
    plan.tests,
    'Executed test identity union differs from full discovery.'
  );
  return { files: actualFiles.length, passed: passed.length, skipped: skipped.length };
}
async function main(args) {
  const cwd = process.cwd();
  const [command, ...paths] = args;
  if (command === 'context' && paths.length === 2 && ['tooling', 'shell'].includes(paths[0])) {
    assert(/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ''), 'Missing exact unit head.');
    assert(/^\d+$/.test(process.env.GITHUB_RUN_ID ?? ''), 'Missing unit workflow run.');
    mkdirSync(paths[1], { recursive: true });
    writeFileSync(
      join(paths[1], 'context.json'),
      JSON.stringify({
        consumer: paths[0],
        sha: process.env.GITHUB_SHA,
        runId: process.env.GITHUB_RUN_ID,
      })
    );
  } else if (command === 'collect' && paths.length === 1) {
    // Static listing cannot expand it.each and does not preserve declared skip modes.
    const { createVitest } = await import('vite-plus/test/node');
    const ctx = await createVitest({ config: 'vitest.config.ts', watch: false, reporters: [] });
    try {
      const result = await ctx.collect([], { staticParse: false });
      assert.equal(result.unhandledErrors.length, 0, 'Unit discovery had unhandled errors.');
      const discovery = result.testModules.flatMap((module) => {
        assert(module.ok(), `Failed unit discovery: ${module.moduleId}`);
        return [...module.children.allTests()].map((test) => ({
          file: module.moduleId,
          name: test.fullName,
          mode: test.options.mode,
        }));
      });
      writeFileSync(paths[0], JSON.stringify(createUnitPlan(discovery, cwd)));
    } finally {
      await ctx.close();
    }
  } else if (command === 'results' && paths.length === 0) {
    checkUnitResults(
      {
        tooling: process.env.TOOLING_RESULT,
        shell: process.env.SHELL_RESULT,
        rules: process.env.RULES_RESULT,
      },
      process.env.REMOTE_RULES,
      process.env.COLAB_RULES
    );
  } else if (command === 'verify' && paths.length === 2) {
    const consumers = Object.fromEntries(
      ['tooling', 'shell'].map((group, index) => [
        group,
        {
          context: readJson(join(paths[index], 'context.json')),
          report: readJson(join(paths[index], 'results.json')),
        },
      ])
    );
    const result = verifyUnitReports(readJson(join(paths[0], 'plan.json')), consumers, {
      cwd,
      sha: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID,
    });
    console.log(
      `Unit coverage union: ${result.files} files, ${result.passed} passed, ${result.skipped} declared skips.`
    );
  } else
    throw new Error(
      'Usage: unit-test-consumers.mjs context <tooling|shell> <directory> | collect <plan> | results | verify <tooling-directory> <shell-directory>'
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2));
