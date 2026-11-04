import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vite-plus/test';
import {
  bundleHash,
  frameDesignSystem,
  resolveDesignSystem,
  type DesignSystemBundle,
} from '../src/design-system.js';

const bundle = (runtime: string, code: string, parts?: string[]): DesignSystemBundle => ({
  schema: 1,
  system: 'test',
  name: 'Test',
  version: '1.0.0',
  runtime,
  prefix: 'test',
  tokensCss: '',
  hash: 'test',
  components: [
    { tag: 'test-page', props: {}, slots: ['default'], css: '', code, ...(parts ? { parts } : {}) },
  ],
});

function load(value: DesignSystemBundle) {
  const { script } = frameDesignSystem(value);
  const table = () => null;
  const defined: string[] = [];
  runInNewContext(script, {
    window: {
      tmt: {
        React: {},
        html: () => {},
        createRoot: () => {},
        sharedParts: { PageListTable: table },
        sharedData: { page: () => undefined },
      },
    },
    customElements: { get: () => undefined, define: (name: string) => defined.push(name) },
    HTMLElement: class {},
  });
  return defined;
}

describe('design-system shared parts', () => {
  it('allows a declared part on runtime 3 and keeps runtime 2 bundles working', () => {
    expect(
      load(bundle('3', 'return ({parts}) => parts.PageListTable;', ['PageListTable'])),
    ).toEqual(['test-page']);
    expect(load(bundle('2', 'return ({React}) => () => React;'))).toEqual(['test-page']);
  });

  it('refuses a part the component did not declare, even when the host provides it', () => {
    expect(() => load(bundle('3', 'return ({parts}) => parts.PageListTable;'))).toThrow(
      'Undeclared shared part',
    );
    expect(() => load(bundle('2', 'return () => null;', ['PageListTable']))).toThrow(
      'Invalid shared parts',
    );
    expect(() => load(bundle('3', 'return () => null;', ['Other']))).toThrow(
      'Invalid shared parts',
    );
  });
  it('refuses undeclared page data and allows only the named runtime 3 capability', () => {
    expect(() => load(bundle('3', 'return ({data}) => data.page;'))).toThrow(
      'Undeclared data capability',
    );
    const base = bundle('3', 'return ({data}) => data.page;');
    const allowed = { ...base, components: [{ ...base.components[0]!, data: ['page'] }] };
    expect(load(allowed)).toEqual(['test-page']);
    const unknown = { ...base, components: [{ ...base.components[0]!, data: ['arbitrary'] }] };
    expect(() => load(unknown)).toThrow('Invalid data capabilities');
  });
  it('reports a newer-runtime notice for a valid release with an unknown capability', async () => {
    const base = bundle('3', 'return () => null;');
    const candidate = { ...base, components: [{ ...base.components[0]!, data: ['future'] }] };
    const hash = await bundleHash(candidate);
    const release = { ...candidate, hash };
    const source = {
      release: async () => release,
      draft: async () => release,
      watch: () => () => {},
    };
    expect(await resolveDesignSystem('test', { version: '1.0.0', hash }, source)).toBe(
      'newer-runtime',
    );
  });
});
