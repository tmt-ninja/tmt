import { expect, it } from 'vite-plus/test';
import { designModuleLoad, designPath, moduleLoad } from '../src/module-entry.js';

const HERE = 'http://127.0.0.1:4000/colab/';
const MOUNT = '/r/abcdefghijklmnop/x/colab/';
const ENTRY = `http://127.0.0.1:4000${MOUNT}assets/colab-module.js`;
const DEFAULT = 'assets/colab-module.js';

it('loads the default entry, or a named file, under the module mount', () => {
  expect(moduleLoad(MOUNT, undefined, HERE, DEFAULT)).toEqual({ link: MOUNT, entry: ENTRY });
  expect(moduleLoad(MOUNT, 'assets/other.js', HERE).entry).toBe(
    `http://127.0.0.1:4000${MOUNT}assets/other.js`,
  );
  expect(moduleLoad(MOUNT, `${MOUNT}assets/colab-module.js`, HERE).entry).toBe(ENTRY);
  // A mount written without its trailing slash is the same mount.
  expect(moduleLoad('/r/abcdefghijklmnop/x/colab', undefined, HERE, DEFAULT)).toEqual({
    link: MOUNT,
    entry: ENTRY,
  });
  expect(moduleLoad(`http://127.0.0.1:4000${MOUNT}`, undefined, HERE, DEFAULT).entry).toBe(ENTRY);
});

it('gives a module that names no entry and has no fallback only its link', () => {
  // The Colab-named script is for Colab alone; another module's mount is never asked for it.
  expect(moduleLoad('/r/abcdefghijklmnop/x/ops/', undefined, HERE)).toEqual({
    link: '/r/abcdefghijklmnop/x/ops/',
  });
  expect(moduleLoad('/r/abcdefghijklmnop/x/ops/', 'app.js', HERE).entry).toBe(
    'http://127.0.0.1:4000/r/abcdefghijklmnop/x/ops/app.js',
  );
});

it('refuses an entry outside the mount and keeps the module link', () => {
  for (const entry of [
    'https://evil.example/colab.js',
    '//evil.example/colab.js',
    '/evil/colab.js',
    '../../colab.js',
    '../colab/assets/x.js',
    './assets/x.js',
    'assets/../x.js',
    '/r/abcdefghijklmnop/x/other/colab.js',
    '/r/abcdefghijklmnop/x/colab-evil/colab.js',
    '/r/zzzzzzzzzzzzzzzz/x/colab/colab.js',
    'assets//x.js',
    'assets/colab.css',
    'assets/colab-module',
    '',
    '.',
  ])
    expect(moduleLoad(MOUNT, entry, HERE), entry).toEqual({ link: MOUNT });
});

it('refuses escapes, backslashes, queries, fragments and control characters', () => {
  for (const entry of [
    'assets%2Fx.js',
    'assets%2fx.js',
    '%2e%2e/x.js',
    'assets/%2E%2E/x.js',
    'assets\\x.js',
    'assets/x.js?v=1',
    'assets/x.js#a',
    'assets/x.js\n',
    'assets/x\u0000.js',
    `${MOUNT}`,
  ])
    expect(moduleLoad(MOUNT, entry, HERE).entry, JSON.stringify(entry)).toBeUndefined();
});

it('offers no link or entry for a mount that is not a module mount on this origin', () => {
  for (const rail of [
    'https://evil.example/r/abcdefghijklmnop/x/colab/',
    '/evil/',
    '/r/abcdefghijklmnop/x/',
    '/r/abcdefghijklmnop/x/colab/extra/',
    '/r/abcdefghijklmnop/x/colab/?q=1',
    '/r/abcdefghijklmnop/x/colab/#a',
    '/r/ABC/x/colab/',
    '',
  ])
    expect(moduleLoad(rail, undefined, HERE), rail).toEqual({});
  expect(moduleLoad(MOUNT, undefined, 'not a url')).toEqual({});
});

const described = (entry: string | undefined = ENTRY, extension = 'colab', path = '/design/') => ({
  version: 1 as const,
  modules: [
    {
      extension: 'colab',
      rail: { label: 'Colab', icon: 'file-text', path: MOUNT, order: 100 },
      menu: [],
      settings: [],
    },
    {
      extension,
      module: 'design',
      rail: { label: 'Design', icon: 'palette', path, order: 150 },
      menu: [],
      settings: [],
      ...(entry === undefined ? {} : { entry }),
    },
  ],
});

it('loads a described Design extra from the primary Colab mount, with no primary-script fallback', () => {
  expect(designModuleLoad(described(), HERE)).toEqual({ link: '/design/', entry: ENTRY });
  const missing = described();
  delete (missing.modules[1] as { entry?: string }).entry;
  expect(designModuleLoad(missing, HERE)).toEqual({ link: '/design/' });
  expect(designModuleLoad({ version: 1, modules: described().modules.slice(0, 1) }, HERE)).toEqual(
    {},
  );
  expect(designModuleLoad(undefined, HERE)).toEqual({});
});

it('confines Design script entries and refuses navigation outside its owned family', () => {
  for (const entry of [
    '/sdk/shell.js',
    '/design/evil.js',
    ENTRY.replace('/colab/', '/ops/'),
    ENTRY + '?x=1',
    'https://evil.example/x.js',
  ])
    expect(designModuleLoad(described(entry), HERE)).toEqual({ link: '/design/' });
  for (const path of [
    '/remote/',
    '/designer/',
    '/design//a',
    '/design/a.b',
    '/design/%61',
    '/design/../remote',
    '/design/?x=1',
    'https://evil.example/design/',
  ])
    expect(designModuleLoad(described(ENTRY, 'colab', path), HERE), path).toEqual({});
  expect(designModuleLoad(described(ENTRY, 'other'), HERE)).toEqual({});
  expect(designModuleLoad(described(), 'not a url')).toEqual({});
  const noPrimary = described();
  noPrimary.modules.shift();
  expect(designModuleLoad(noPrimary, HERE)).toEqual({});
});

it('uses the same bounded Design path family as native owner-route admission', () => {
  for (const path of ['/design', '/design/', '/design/a-1_B', '/design/' + 'a'.repeat(160)])
    expect(designPath(path)).toBe(true);
  for (const path of [
    '/designx',
    '/design/a/',
    '/design//a',
    '/design/..',
    '/design/a.b',
    '/design/%2f',
    '/design/' + 'a'.repeat(161),
  ])
    expect(designPath(path)).toBe(false);
});
