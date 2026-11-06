export const UNIT_CONSUMER_NAMES: Readonly<Record<'tooling' | 'shell' | 'rules', string>>;
export const SHELL_TEST: string;
export function toolingGroup(file: string): 'tooling' | 'shell';
export function readToolingGroups(cwd: string): { tooling: string[]; shell: string[] };
export interface UnitPlan {
  files: { tooling: string[]; shell: string[] };
  tests: string[][];
}
export function createUnitPlan(discovery: unknown, cwd: string): UnitPlan;
export function checkUnitResults(
  results: { tooling?: string; shell?: string; rules?: string },
  remoteRules: string | undefined,
  colabRules: string | undefined
): void;
export function verifyUnitReports(
  plan: UnitPlan,
  consumers: Record<
    string,
    { context: { consumer: string; sha: string; runId: string }; report: unknown }
  >,
  context: { cwd: string; sha: string; runId: string }
): { files: number; passed: number; skipped: number };
