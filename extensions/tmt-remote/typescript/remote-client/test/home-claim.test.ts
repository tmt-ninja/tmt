import { claimedHome, type ShellAnswer, type ShellModule } from '@tmt/browser-ui/shell';
import { expect, it } from 'vite-plus/test';

// #6474: one installed module may replace Remote's Home with a page under its own mount.
const module = (extension: string, homePage?: string, extra?: string): ShellModule => ({
  extension,
  ...(extra ? { module: extra } : {}),
  rail: { label: extension, icon: 'box', path: `https://door/r/a/x/${extension}/`, order: 1 },
  menu: [],
  settings: [],
  ...(homePage === undefined ? {} : { homePage }),
});
const answer = (...modules: ShellModule[]): ShellAnswer => ({ version: 1, modules });

it('opens the one module that claims Home', () => {
  expect(
    claimedHome(answer(module('colab', 'https://door/r/a/x/colab/work'), module('digest'))),
  ).toBe('https://door/r/a/x/colab/work');
});
it('keeps Remote Home with no claim or no answer', () => {
  expect(claimedHome(answer(module('colab'), module('digest')))).toBeUndefined();
  expect(claimedHome(undefined)).toBeUndefined();
});
it('keeps Remote Home for an invalid claim', () => {
  for (const home of [
    'https://door/r/a/x/digest/work',
    'https://elsewhere/r/a/x/colab/work',
    'https://door/r/a/x/colab/../digest/',
    'https://door/r/a/x/colab/work?next=/',
  ])
    expect(claimedHome(answer(module('colab', home))), home).toBeUndefined();
  expect(
    claimedHome(answer(module('colab', 'https://door/r/a/x/colab/design/', 'design'))),
  ).toBeUndefined();
});
it('keeps Remote Home when two modules claim it', () => {
  expect(
    claimedHome(
      answer(
        module('colab', 'https://door/r/a/x/colab/work'),
        module('digest', 'https://door/r/a/x/digest/home'),
      ),
    ),
  ).toBeUndefined();
});
