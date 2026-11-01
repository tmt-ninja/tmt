// Types for compiler.mjs, the design-system compiler the Colab app shares with compile.mjs.
export const SCHEMA: 1;
export const RUNTIME: '2';
export const SKELETON: readonly string[];
export class DesignSystemError extends Error {}
export interface PropSpec {
  enum?: string[];
  type?: 'boolean' | 'string';
  default?: string;
}
export interface ComponentDoc {
  schema: number;
  kind: 'component';
  tag: string;
  props: Record<string, PropSpec>;
  slots: string[];
  examples?: { title: string; markup: string; widths?: number[] }[];
  source: string;
  css: string;
}
export interface DesignSystemConfig {
  schema: number;
  kind: 'design-system';
  id?: string;
  name: string;
  prefix: string;
  version: string;
  runtime: string;
  tokens: { css: string; source?: string };
  components: { page?: string; tag: string; status?: string }[];
  principles?: { summary: string; rules: string[] };
  patterns?: { page: string; title: string; uses: string[] }[];
  site?: { nav: string[]; controls: string[]; previewWidths: number[] };
  releases: { version: string; bundle: string; attachment?: string; runtime: string; at?: string }[];
}
export interface Bundle {
  schema: number;
  system: string;
  name: string;
  version: string;
  runtime: string;
  prefix: string;
  tokensCss: string;
  components: { tag: string; props: Record<string, PropSpec>; slots: string[]; css: string; code: string }[];
  hash: string;
}
export interface Finding {
  code: 'ds-not-pinned' | 'unknown-ds-release' | 'ds-prefix-mismatch' | 'unknown-ds-component' | 'invalid-ds-prop';
  tag: string;
  attribute?: string;
  index: number;
}
export function checkSchema(doc: unknown, where: string): void;
export function propType(spec: PropSpec): string;
export function validateSystem(config: DesignSystemConfig, where?: string): void;
export function checkSource(source: string, where: string): void;
export function validateComponent(doc: ComponentDoc, where?: string): void;
export function buildBundle(
  system: string,
  config: DesignSystemConfig,
  components: ComponentDoc[],
  sha256Hex: (text: string) => Promise<string>,
): Promise<Bundle>;
export function checkElements(
  elements: { tag: string; attrs: Record<string, string> }[],
  pin: { system: string; version: string; hash: string } | null,
  bundle: Bundle | null,
): Finding[];
export const findingText: Record<Finding['code'], (finding: Finding) => string>;
