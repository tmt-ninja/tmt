import { useEffect, useMemo, type CSSProperties } from 'react';
import { BrowserShell } from '../src/react.js';
import {
  shellCount,
  shellRail,
  type ShellAnswer,
  type ShellCommonControls,
  type ShellMenu,
  type ShellMenuItem,
  type ShellModule,
} from '../src/shell.js';
import { Button, Separator, UiTheme } from '../src/ui/index.js';
import { ListScreen } from './mock-list.js';
import { ManageDialog, menuControls, SettingsScreen } from './mock-menu.js';
import { ninjaMarkSvg } from './ninja-mark.js';
import { ReaderScreen } from './mock-reader.js';
import { usePreview } from './preview.js';
import { follow, navigate, setQuery, useQuery } from './router.js';
import { colabMockBase, guiRoot } from './routes.js';

/*
 * The Colab mockup (#5821): the side menu, the page list, the reader and Colab settings, built from the
 * design-system parts in palette B. The rail and the module menu are the shared shell; everything in
 * the content area is a `ui` part. Each screen lists the pieces that are stand-ins until a part exists.
 */

const base = colabMockBase;
const colab: ShellModule = {
  extension: 'colab',
  rail: { label: 'Colab', icon: 'file-text', path: `${base}`, order: 100 },
  menu: [],
  settings: [],
  needsYou: 4,
};
const answer: ShellAnswer = {
  version: 1,
  modules: [
    colab,
    {
      extension: 'remote',
      rail: {
        label: 'Remote',
        icon: 'monitor-smartphone',
        path: `${guiRoot}/mocks/remote`,
        order: 200,
      },
      menu: [],
      settings: [],
      needsYou: 1,
    },
    {
      extension: 'ops',
      rail: { label: 'Ops', icon: 'users', path: `${guiRoot}/mocks/ops`, order: 300 },
      menu: [],
      settings: [],
      needsYou: 0,
    },
  ],
};
const common: ShellCommonControls = {
  openSearch: () => {},
  remote: { kind: 'confirmed', liveSessions: 2, href: base },
};

type Screen = 'menu' | 'list' | 'page' | 'settings';
const screens: { id: Screen; label: string; href: string }[] = [
  { id: 'menu', label: 'Side menu', href: `${base}/menu` },
  { id: 'list', label: 'Page list', href: base },
  { id: 'page', label: 'Page detail', href: `${base}/page` },
  { id: 'settings', label: 'Settings', href: `${base}/settings` },
];

/** Corner radius steps to try (Ben, 11-02): `radius`/`radius-l`, set on the mock's palette-B scope
 * through the one knob. Avatars, radios and status dots keep `radius-pill`. */
const radii = [
  { id: '2', label: '2/4', radius: 2, step: 2 },
  { id: '4', label: '4/6', radius: 4, step: 2 },
  { id: '6', label: '6/10', radius: 6, step: 4 },
  { id: '8', label: '8/12', radius: 8, step: 4 },
] as const;
const logos = [
  { id: 'tmt', label: 'Current' },
  { id: 'ninja', label: 'Ninja' },
] as const;
const radiusOf = (query: URLSearchParams) =>
  radii.find((entry) => entry.id === query.get('radius')) ?? radii[0];
const logoOf = (query: URLSearchParams) => (query.get('logo') === 'ninja' ? 'ninja' : 'tmt');

interface Entry {
  id: string;
  label: string;
  href?: string;
  total?: number;
  needsYou?: number;
  unread?: boolean;
  children?: Entry[];
}
/** Colab's menu with #5826 proposal C: All pages, then the Shortcuts group with Manage. */
const shortcuts: Entry[] = [
  { id: 'spec', label: 'spec', total: 19, needsYou: 3 },
  { id: 'night', label: 'night', total: 1 },
  { id: 'pm', label: 'pm', total: 2 },
  { id: 'design', label: 'design', total: 3, needsYou: 1 },
  { id: 'blog', label: 'blog', total: 2 },
];

function buildMenu(current: string, withShortcuts: boolean, needs: boolean): ShellMenu {
  const item = (entry: Entry): ShellMenuItem => ({
    id: entry.id,
    label: entry.label,
    href: entry.href ?? `${base}#${entry.id}`,
    current: entry.id === current,
    total: entry.total,
    count: needs && entry.needsYou ? shellCount(entry.needsYou) : undefined,
    icon: entry.id === 'all' ? 'list' : 'bookmark',
  });
  return {
    title: 'Colab',
    groups: [
      { items: [item({ id: 'all', label: 'All pages', href: base, total: 99, needsYou: 16 })] },
      {
        label: 'Shortcuts',
        action: { label: 'Manage', onActivate: () => setQuery({ manage: '1' }) },
        items: withShortcuts ? shortcuts.map(item) : [],
      },
    ],
    settings: {
      id: 'settings',
      label: 'Colab settings',
      icon: 'settings',
      href: `${base}/settings`,
      current: current === 'settings',
    },
  };
}

/** The mock's global switches: the screen, the corner radius, the logo, and the way back to the
 * docs. The theme is the GUI's. Radius and logo live in the query, so a link reproduces them. */
export function GlobalSwitches({ screen }: { screen: Screen }) {
  const query = useQuery();
  const radius = radiusOf(query);
  const logo = logoOf(query);
  const kept = new URLSearchParams(
    [...query].filter(([key]) => key === 'radius' || key === 'logo'),
  ).toString();
  const row = <T extends string>(
    label: string,
    entries: readonly { id: T; label: string }[],
    current: T,
    choose: (id: T) => void,
  ) => (
    <>
      <p className="mock-switch-label">{label}</p>
      <div className="mock-switch-row" role="group" aria-label={label}>
        {entries.map((entry) => (
          <Button
            key={entry.id}
            type="button"
            size="xs"
            variant={entry.id === current ? 'secondary' : 'ghost'}
            aria-pressed={entry.id === current}
            onClick={() => choose(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </div>
    </>
  );
  return (
    <>
      {row('Screen', screens, screen, (id) =>
        navigate(`${screens.find((entry) => entry.id === id)!.href}${kept ? `?${kept}` : ''}`),
      )}
      {row('Radius', radii, radius.id, (id) => setQuery({ radius: id === '2' ? null : id }))}
      {row('Logo', logos, logo, (id) => setQuery({ logo: id === 'tmt' ? null : id }))}
      <Separator />
      <a className="mock-switch-link" href={guiRoot} onClick={follow}>
        ← Design system docs
      </a>
    </>
  );
}

export function ColabMock({ path }: { path: string }) {
  const screen: Screen = path.startsWith(`${base}/page`)
    ? 'page'
    : path.startsWith(`${base}/menu`)
      ? 'menu'
      : path.startsWith(`${base}/settings`)
        ? 'settings'
        : 'list';
  const { theme } = usePreview();
  const query = useQuery();
  const withShortcuts = query.get('shortcuts') !== 'none';
  const needs = query.get('dots') !== 'off';
  const view = useMemo(() => {
    const place = { origin: location.origin, href: `${location.origin}${base}` };
    return {
      rail: shellRail(answer, place, colab),
      menu: buildMenu(
        screen === 'settings' ? 'settings' : screen === 'page' ? '' : 'all',
        withShortcuts,
        needs,
      ),
    };
  }, [screen, withShortcuts, needs]);
  // The side-menu screen opens the drawer on a phone, where the menu otherwise waits behind its button.
  useEffect(() => {
    if (screen !== 'menu' || !matchMedia('(max-width: 900px)').matches) return;
    document.querySelector<HTMLButtonElement>('.tmt-ui-shell-open')?.click();
  }, [screen]);
  const globals = <GlobalSwitches screen={screen} />;
  const radius = radiusOf(query);
  const logo = logoOf(query);
  // The ninja option swaps the shell's mark in this mock only: the shell draws its brand itself.
  useEffect(() => {
    const brand = document.querySelector<HTMLElement>('.tmt-ui-shell-brand');
    if (!brand) return;
    brand.dataset.mockLogo = logo;
    let ninja = brand.querySelector('.mock-ninja-mark');
    if (logo === 'ninja' && !ninja) {
      ninja = Object.assign(document.createElement('span'), { className: 'mock-ninja-mark' });
      ninja.innerHTML = ninjaMarkSvg;
      brand.prepend(ninja);
    }
  }, [logo, view]);
  // The radius knob only moves inside a palette-B scope; the mock carries its own, so the switch
  // works on the docs server and inside Design alike.
  const scope = {
    display: 'contents',
    '--tmt-ui-ref-radius': `${radius.radius}px`,
    '--tmt-ui-ref-radius-step': `${radius.step}px`,
  } as CSSProperties;
  return (
    <div data-tmt-palette="b" data-mock-radius={radius.id} style={scope}>
      <UiTheme theme={theme}>
        <BrowserShell
          view={view}
          commonControls={common}
          select={(_, href) => {
            const target = new URL(href, location.origin);
            if (target.pathname.startsWith(base) && !target.hash) navigate(target.pathname);
            return true;
          }}
        >
          {screen === 'page' ? (
            <ReaderScreen globals={globals} />
          ) : screen === 'settings' ? (
            <SettingsScreen globals={globals} />
          ) : (
            <ListScreen globals={globals} controls={screen === 'menu' ? menuControls : undefined} />
          )}
        </BrowserShell>
        {query.get('manage') === '1' && <ManageDialog />}
      </UiTheme>
    </div>
  );
}
