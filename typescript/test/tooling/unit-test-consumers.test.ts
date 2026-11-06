import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import {
  checkUnitResults,
  createUnitPlan,
  readToolingGroups,
  SHELL_TEST,
  toolingGroup,
  verifyUnitReports,
} from '../../scripts/unit-test-consumers.mjs';

let root: string;
const sha = 'a'.repeat(40),
  runId = '42';
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'unit-consumers-')));
  mkdirSync(join(root, 'test/tooling'), { recursive: true });
  writeFileSync(join(root, 'test/tooling/a.test.ts'), '');
  writeFileSync(join(root, SHELL_TEST), '');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const discovery = () => [
  { file: join(root, 'test/tooling/a.test.ts'), name: 'alpha', mode: 'run' },
  { file: join(root, SHELL_TEST), name: 'path setup', mode: 'run' },
  { file: join(root, 'test/tooling/a.test.ts'), name: 'optional provider', mode: 'skip' },
];
const evidence = () => ({
  tooling: {
    context: { consumer: 'tooling', sha, runId },
    report: {
      success: true,
      testResults: [
        {
          name: join(root, 'test/tooling/a.test.ts'),
          assertionResults: [
            { ancestorTitles: [], title: 'alpha', status: 'passed' },
            { ancestorTitles: [], title: 'optional provider', status: 'skipped' },
          ],
        },
      ],
    },
  },
  shell: {
    context: { consumer: 'shell', sha, runId },
    report: {
      success: true,
      testResults: [
        {
          name: join(root, SHELL_TEST),
          assertionResults: [{ ancestorTitles: [], title: 'path setup', status: 'passed' }],
        },
      ],
    },
  },
});
const context = () => ({ cwd: root, sha, runId });

describe('retained unit consumer inventory', () => {
  it('records expanded declarations and inherited skips during the ordinary Vitest run', () => {
    const imports = `import {describe,it} from ${JSON.stringify(import.meta.resolve('vite-plus/test'))};\n`;
    writeFileSync(
      join(root, 'vitest.config.ts'),
      'export default {test:{include:["test/tooling/*.test.ts"],pool:"threads",maxWorkers:1}};'
    );
    writeFileSync(
      join(root, 'test/tooling/a.test.ts'),
      imports +
        'describe("suite",()=>{it.each([1,2])("case %s",()=>{});it.skip("declared",()=>{});describe.skip("parent",()=>{it("child",()=>{})})});'
    );
    writeFileSync(join(root, SHELL_TEST), imports + 'it("shell",()=>{});');
    const output = join(root, 'declarations.json');
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {createVitest} from ${JSON.stringify(import.meta.resolve('vite-plus/test/node'))};
        const ctx=await createVitest({config:'vitest.config.ts',watch:false,reporters:['json',${JSON.stringify(fileURLToPath(new URL('../../scripts/unit-test-consumers.mjs', import.meta.url)))}],outputFile:${JSON.stringify(join(root, 'results.json'))}});
        try {const result=await ctx.start();if(result.unhandledErrors.length || result.testModules.some(m=>!m.ok()))throw Error('Fixture run failed');} finally {await ctx.close();}`,
      ],
      {
        cwd: root,
        env: { ...process.env, UNIT_TEST_EVIDENCE: root },
        encoding: 'utf8',
        timeout: 8000,
        maxBuffer: 1024 * 1024,
      }
    );
    expect(result.status, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`).toBe(0);
    const plan = createUnitPlan(JSON.parse(readFileSync(output, 'utf8')), root);
    const report = JSON.parse(readFileSync(join(root, 'results.json'), 'utf8'));
    expect(report.success).toBe(true);
    const identities = report.testResults.flatMap(
      (file: {
        name: string;
        assertionResults: { title: string; ancestorTitles: string[]; status: string }[];
      }) =>
        file.assertionResults.map((test) => [
          file.name.slice(root.length + 1),
          [...test.ancestorTitles, test.title].join(' > '),
          test.status === 'passed' ? 'passed' : 'skipped',
        ])
    );
    expect(identities.sort()).toEqual(plan.tests.sort());
    expect(plan.tests.sort()).toEqual(
      [
        ['test/tooling/a.test.ts', 'suite > case 1', 'passed'],
        ['test/tooling/a.test.ts', 'suite > case 2', 'passed'],
        ['test/tooling/a.test.ts', 'suite > declared', 'skipped'],
        ['test/tooling/a.test.ts', 'suite > parent > child', 'skipped'],
        [SHELL_TEST, 'shell', 'passed'],
      ].sort()
    );
  });
  it('assigns every nested test exactly once and keeps zsh isolated', () => {
    mkdirSync(join(root, 'test/tooling/nested'));
    writeFileSync(join(root, 'test/tooling/nested/b.test.ts'), '');
    writeFileSync(join(root, 'test/tooling/not-a-test.ts'), '');
    expect(readToolingGroups(root)).toEqual({
      tooling: ['test/tooling/a.test.ts', 'test/tooling/nested/b.test.ts'],
      shell: [SHELL_TEST],
    });
    expect(toolingGroup(SHELL_TEST)).toBe('shell');
  });
  it('rejects empty projects, symlink discovery and files outside the retained suite', () => {
    rmSync(join(root, SHELL_TEST));
    expect(() => readToolingGroups(root)).toThrow('Empty');
    writeFileSync(join(root, SHELL_TEST), '');
    symlinkSync(join(root, SHELL_TEST), join(root, 'test/tooling/alias.test.ts'));
    expect(() => readToolingGroups(root)).toThrow('symlink');
    expect(() => toolingGroup('../native/a.test.ts')).toThrow('Not a tooling test');
  });
  it('rejects empty or foreign runnable discovery', () => {
    expect(() => createUnitPlan([], root)).toThrow('Empty');
    expect(() =>
      createUnitPlan([{ name: 'x', file: join(root, 'foreign.test.ts') }], root)
    ).toThrow('Not a tooling test');
  });
});

describe('selected unit consumers', () => {
  it.each([
    ['false', 'false'],
    ['true', 'false'],
    ['false', 'true'],
    ['true', 'true'],
  ])('requires the exact Rules selection %s/%s', (remote, colab) => {
    const rules = remote === 'true' || colab === 'true' ? 'success' : 'skipped';
    expect(() =>
      checkUnitResults({ tooling: 'success', shell: 'success', rules }, remote, colab)
    ).not.toThrow();
    expect(() =>
      checkUnitResults(
        {
          tooling: 'success',
          shell: 'success',
          rules: rules === 'success' ? 'skipped' : 'success',
        },
        remote,
        colab
      )
    ).toThrow('Rules consumer');
  });
  it.each(['failure', 'cancelled', 'skipped', undefined])(
    'refuses an unsuccessful selected consumer: %s',
    (state) => {
      expect(() =>
        checkUnitResults({ tooling: state, shell: 'success', rules: 'skipped' }, 'false', 'false')
      ).toThrow('tooling');
      expect(() =>
        checkUnitResults({ tooling: 'success', shell: state, rules: 'skipped' }, 'false', 'false')
      ).toThrow('shell');
    }
  );
  it('refuses missing selection and an extra consumer', () => {
    expect(() =>
      checkUnitResults(
        { tooling: 'success', shell: 'success', rules: 'skipped' },
        undefined,
        'false'
      )
    ).toThrow('selection');
    expect(() =>
      checkUnitResults(
        Object.assign(
          { extra: 'success' },
          { tooling: 'success', shell: 'success', rules: 'skipped' }
        ),
        'false',
        'false'
      )
    ).toThrow('inventory');
  });
});

describe('executed unit coverage union', () => {
  it('refuses missing workflow identity and undeclared skip modes', () => {
    expect(() =>
      verifyUnitReports(createUnitPlan(discovery(), root), evidence(), { ...context(), sha: '' })
    ).toThrow('Missing exact unit head');
    expect(() =>
      verifyUnitReports(createUnitPlan(discovery(), root), evidence(), { ...context(), runId: '' })
    ).toThrow('Missing unit workflow run');
    expect(() => createUnitPlan([{ ...discovery()[0], mode: 'only' }], root)).toThrow(
      'Unsupported test mode'
    );
  });
  it('matches every runnable identity and reports declared skips separately', () => {
    expect(verifyUnitReports(createUnitPlan(discovery(), root), evidence(), context())).toEqual({
      files: 2,
      passed: 2,
      skipped: 1,
    });
  });
  it.each(['sha', 'runId', 'consumer'] as const)('rejects a foreign %s', (field) => {
    const reports = evidence();
    reports.shell.context[field] = 'foreign';
    expect(() =>
      verifyUnitReports(createUnitPlan(discovery(), root), reports, context())
    ).toThrow();
  });
  it.each(['missing', 'duplicate', 'wrong-consumer', 'failed'])(
    'rejects %s file evidence',
    (mode) => {
      const reports = evidence();
      if (mode === 'missing') reports.shell.report.testResults = [];
      if (mode === 'duplicate')
        reports.tooling.report.testResults.push(reports.tooling.report.testResults[0]);
      if (mode === 'wrong-consumer')
        reports.shell.report.testResults[0].name = join(root, 'test/tooling/a.test.ts');
      if (mode === 'failed') reports.tooling.report.success = false;
      expect(() =>
        verifyUnitReports(createUnitPlan(discovery(), root), reports, context())
      ).toThrow();
    }
  );
  it.each(['renamed', 'omitted', 'extra', 'skipped', 'failure'])(
    'rejects %s runnable identity evidence',
    (mode) => {
      const reports = evidence(),
        tests = reports.tooling.report.testResults[0].assertionResults;
      if (mode === 'renamed') tests[0].title = 'not alpha';
      if (mode === 'omitted') tests.shift();
      if (mode === 'extra') tests.push({ ancestorTitles: [], title: 'extra', status: 'passed' });
      if (mode === 'skipped' || mode === 'failure') tests[0].status = mode;
      expect(() =>
        verifyUnitReports(createUnitPlan(discovery(), root), reports, context())
      ).toThrow();
    }
  );
});
