import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import {
  BrowserPageSubheader,
  BrowserPanel,
  BrowserSection,
  BrowserShell,
  BrowserStatusTile,
  BrowserStatusTiles,
  BrowserTopBar,
} from '../src/react.js';
import { shellCount, type ShellCommonControls, type ShellView } from '../src/shell.js';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DsScope,
  Switch,
  UiTheme,
} from '../src/ui/index.js';
import { BrowserPageRow } from '../src/pattern-parts/index.js';
import { usePreview } from './preview.js';

/**
 * The shell, page-template and responsive patterns (#5831). Each scene is the shipped shell and
 * parts inside a stage at a chosen width, so the shell's and the parts' own width rules apply
 * (`ds-scope.css` turns the shell's media rules into stage container queries). The rules quoted
 * here are owned by design/gui-style.md and the browser-ui README; this page shows them.
 */

/** The widths a stage can take: each shipped breakpoint, one phone and one desktop. */
const snapWidths = [390, 480, 640, 760, 900, 1180, 1440] as const;

/** Keep the stage's real width while fitting its preview into the page column. */
export function PatternStage({
  width,
  height,
  theme,
  caption,
  children,
}: {
  width: number;
  height: number;
  theme: 'light' | 'dark';
  caption?: ReactNode;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const fit = () => setScale(Math.min(1, node.clientWidth / width));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [width]);
  return (
    <figure className="pattern-viewport" data-width={width} data-theme={theme}>
      <figcaption>{caption ?? `${width} · ${theme}`}</figcaption>
      <div className="scaled-frame" ref={box} style={{ maxWidth: width, height: height * scale }}>
        <DsScope
          className="scaled-frame-inline"
          style={{ width, height, transform: `scale(${scale})` }}
        >
          <div data-theme={theme}>
            <UiTheme theme={theme}>
              <div className="pattern-frame">{children}</div>
            </UiTheme>
          </div>
        </DsScope>
      </div>
    </figure>
  );
}

/** A scene at one width at a time; the buttons step through the breakpoints. */
function SnapStage({
  label,
  height,
  start = 1440,
  children,
}: {
  label: string;
  height: number;
  start?: (typeof snapWidths)[number];
  children(width: number): ReactNode;
}) {
  const { theme } = usePreview();
  const [width, setWidth] = useState<number>(start);
  return (
    <div className="layout-stage">
      <div className="layout-stage-widths" role="group" aria-label={`${label} preview width`}>
        {snapWidths.map((entry) => (
          <Button
            key={entry}
            type="button"
            size="xs"
            variant={entry === width ? 'secondary' : 'ghost'}
            aria-pressed={entry === width}
            onClick={() => setWidth(entry)}
          >
            {entry}
          </Button>
        ))}
      </div>
      <PatternStage
        width={width}
        height={height}
        theme={theme}
        caption={`${label} · ${width} px · ${band(width)}`}
      >
        {children(width)}
      </PatternStage>
    </div>
  );
}

/** The band a width falls in, named as the responsive rules name it. */
function band(width: number): string {
  if (width <= 480) return 'phone, narrow';
  if (width <= 640) return 'phone';
  if (width <= 760) return 'compact';
  if (width <= 900) return 'tablet, rail in a drawer';
  return 'wide, rail beside the page';
}

const common: ShellCommonControls = {
  openSearch() {},
  remote: { kind: 'confirmed', liveSessions: 2, href: '#' },
};

function sampleView(current: string): ShellView {
  const row = (id: string, label: string, extra = {}) => ({
    id,
    label,
    href: `#${id}`,
    current: id === current,
    ...extra,
  });
  return {
    rail: {
      main: [
        { ...row('home', 'Home'), icon: 'house' },
        { ...row('colab', 'Colab'), icon: 'file-text', current: true, count: shellCount(3) },
        { ...row('remote', 'Remote'), icon: 'monitor-smartphone' },
        { ...row('ops', 'Ops'), icon: 'users' },
      ],
      bottom: [{ ...row('settings', 'TMT settings'), icon: 'settings' }],
    },
    menu: {
      title: 'Colab',
      groups: [
        { items: [row('all', 'All pages', { icon: 'list', total: 38 })] },
        {
          label: 'Shortcuts',
          items: [
            row('spec', 'spec', { icon: 'bookmark', total: 19, count: shellCount(3) }),
            row('design', 'design', { icon: 'bookmark', total: 3 }),
            row('night', 'night', { icon: 'bookmark', total: 1 }),
          ],
        },
      ],
      settings: row('colab-settings', 'Colab settings', { icon: 'settings' }),
    },
  } as ShellView;
}

/** The shipped shell around a page: rail and module menu, the shared top bar and the route's page. */
function Shell({
  current,
  title,
  children,
}: {
  current: string;
  title: string;
  children: ReactNode;
}) {
  const view = useMemo(() => sampleView(current), [current]);
  return (
    <BrowserShell view={view} commonControls={common} select={() => true}>
      <BrowserTopBar title={<h1>{title}</h1>} />
      {children}
    </BrowserShell>
  );
}

const pages = [
  { title: 'Release plan', tags: ['spec', 'tmt'], updated: '2 min ago', unread: true },
  { title: 'Theme B review', tags: ['design'], updated: '1 h ago', state: 'waiting' as const },
  { title: 'CI flake triage', tags: ['infra'], updated: 'Yesterday', state: 'blocked' as const },
  { title: 'Night shift notes', tags: ['night'], updated: 'Mon' },
  { title: 'Squad layout', tags: ['spec'], updated: '12 Nov' },
];

function ListPage() {
  return (
    <div className="tmt-ui-page layout-column">
      <BrowserPageSubheader
        title="All pages"
        count={38}
        actions={
          <Button type="button" collapseLabel="New page">
            <Plus aria-hidden="true" />
          </Button>
        }
      />
      <div className="layout-rows">
        {pages.map((page) => (
          <BrowserPageRow key={page.title} {...page} href="#page" onFollow={() => true} />
        ))}
      </div>
    </div>
  );
}

/** Column from 1180 px, card from 761 px, sheet through 760 px: Colab's Comments panel. */
function panelMode(width: number) {
  return width >= 1180 ? 'column' : width > 760 ? 'card' : 'sheet';
}

function DetailPage({ width }: { width: number }) {
  const mode = panelMode(width);
  return (
    <div className="layout-detail" data-panel={mode}>
      <article className="tmt-ui-page layout-article">
        <p>
          The page reads in one column of at most 720 px. A side panel joins as a column of the page
          grid only when there is room beside that column.
        </p>
        <p>
          Below that it floats as a card over the page, then becomes a sheet at the bottom on a
          phone. The page stays interactive in every mode: there is no scrim and no focus trap.
        </p>
      </article>
      <BrowserPanel open mode={mode} title="Comments" caption="3 open" onDismiss={() => {}}>
        <p className="layout-panel-line">Ben · Can the list keep its tags at 390?</p>
        <p className="layout-panel-line">gui-4 · Yes: tags wrap under the title.</p>
      </BrowserPanel>
    </div>
  );
}

function SettingRow({ label, description }: { label: string; description: string }) {
  const [on, setOn] = useState(true);
  return (
    <div className="layout-setting">
      <div>
        <p className="layout-setting-label">{label}</p>
        <p className="layout-setting-description">{description}</p>
      </div>
      <Switch checked={on} onCheckedChange={setOn} aria-label={label} />
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="tmt-ui-page layout-column">
      <BrowserSection heading="Pages" variant="title" divided>
        <SettingRow
          label="Open new pages"
          description="Open a page in this browser when it is created."
        />
        <SettingRow label="Show rule tags" description="Show template rules to the page owner." />
      </BrowserSection>
      <BrowserSection heading="Notifications" variant="title">
        <SettingRow label="Replies" description="Notify when an agent replies to you." />
      </BrowserSection>
    </div>
  );
}

const cards = [
  ['Needs you', 'Pages waiting on an answer from you.', '4'],
  ['In progress', 'Pages an agent is working on.', '9'],
  ['Done this week', 'Pages closed since Monday.', '13'],
] as const;

function OverviewPage() {
  return (
    <div className="tmt-ui-page layout-column">
      <BrowserStatusTiles>
        <BrowserStatusTile label="Pages" value="38" numeric />
        <BrowserStatusTile label="Needs you" value="4" numeric tone="waiting" />
        <BrowserStatusTile label="Remote" value="Available" tone="working" />
      </BrowserStatusTiles>
      <div className="layout-cards">
        {cards.map(([title, description, value]) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="layout-card-value">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export interface LayoutDoc {
  slug: string;
  title: string;
  lead: string;
  render(): ReactNode;
}

const template = (
  label: string,
  current: string,
  height: number,
  page: (w: number) => ReactNode,
) => (
  <section className="docs-variant" key={label}>
    <h3>{label}</h3>
    <SnapStage label={label} height={height}>
      {(width) => (
        <Shell current={current} title={label}>
          {page(width)}
        </Shell>
      )}
    </SnapStage>
  </section>
);

const rules = (items: ReactNode[]) => (
  <ul className="docs-list">
    {items.map((item, index) => (
      <li key={index}>{item}</li>
    ))}
  </ul>
);

const breakpoints: [string, string][] = [
  [
    '≤ 480 px',
    'Drawer gutters drop from 8 to 4 px; tab-bar status and block chrome wrap or hide by their own width.',
  ],
  [
    '≤ 640 px',
    'Phone: drawers fill the width, top-bar search and chip move into menus, Colab pages switch to their phone layouts and block menus open as bottom sheets.',
  ],
  [
    '≤ 760 px',
    'Compact: page insets 24/18 px, compact title and body sizes, list tables drop columns, a side panel is a sheet.',
  ],
  [
    '≤ 900 px',
    'The rail becomes a menu button that opens it as a drawer; the top bar is 56 px and its title prefixes and chips hide.',
  ],
  [
    '1080 px',
    'Not a breakpoint: the widest a list, settings or overview column grows; the canvas behind it stays edge to edge.',
  ],
  [
    '≥ 1180 px',
    'A side panel can take its own column beside the page; from 761 px it is a floating card.',
  ],
];

/** The shell, page templates and responsive rules, each a live stage at a chosen width. */
export const layoutPatterns: LayoutDoc[] = [
  {
    slug: 'shell',
    title: 'Shell',
    lead: 'Every module sits in one shell: the rail of modules and the module’s own menu on the left, the shared top bar above the page. The module owns everything inside the page.',
    render: () => (
      <>
        {rules([
          'The rail is 232 px. One deepest current row is selected with a soft accent fill; its module shows bold with an accent icon.',
          'The top bar is 62 px (56 px through 900 px). Its left group is navigation, phone search and the route’s one h1; status, the common controls and the page menu follow on the right.',
          'Through 900 px the rail and menu become one drawer behind the top-left menu button, with the same tree.',
          'The shell adds no padding or width to the page; each module keeps its own layout.',
        ])}
        {template('Shell', 'all', 560, () => (
          <ListPage />
        ))}
      </>
    ),
  },
  {
    slug: 'page-layouts',
    title: 'Page layouts',
    lead: 'Four page templates cover the modules: a list, a detail with a side panel, settings and an overview. Each is a column of at most 1080 px centred on an edge-to-edge canvas, inside the shared page insets.',
    render: () => (
      <>
        {rules([
          'Page insets are 33/36 px block/inline, 24/18 px through 760 px (tmt-ui-page).',
          'List: the page subheader names the list and its count and carries the one creation action; rows follow.',
          'Detail: the reading column is at most 720 px. A side panel is a 286 px column with a 34 px gap from 1180 px, a 330 px card from 761 px and a sheet through 760 px.',
          'Settings: titled sections; each row is a label and description with its control at the end.',
          'Overview: status tiles first, then cards that wrap to fewer columns as the width narrows.',
        ])}
        {template('List', 'all', 520, () => (
          <ListPage />
        ))}
        {template('Detail with side panel', 'spec', 520, (width) => (
          <DetailPage width={width} />
        ))}
        {template('Settings', 'colab-settings', 520, () => (
          <SettingsPage />
        ))}
        {template('Overview', 'all', 560, () => (
          <OverviewPage />
        ))}
      </>
    ),
  },
  {
    slug: 'responsive',
    title: 'Responsive rules',
    lead: 'Four breakpoints change a page: 480, 640, 760 and 900 px. Components that live in narrow places answer to their own width instead of the window.',
    render: () => (
      <>
        {rules([
          'A page rule uses the window width (@media); a part that can sit in a narrow column (tabs bar, blocks, header) uses its container.',
          'A rule applies through its width (max-width at the listed value): 640 px is still the phone layout, 641 px is not.',
          'Use only these widths; a new one needs a design-system change first.',
        ])}
        <table className="docs-props">
          <thead>
            <tr>
              <th scope="col">Width</th>
              <th scope="col">What changes</th>
            </tr>
          </thead>
          <tbody>
            {breakpoints.map(([width, change]) => (
              <tr key={width}>
                {/* One line: the value and its unit never part (non-breaking spaces). */}
                <td className="layout-width">{width.replaceAll(' ', '\u00a0')}</td>
                <td>{change}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {template('A page across the breakpoints', 'spec', 560, (width) => (
          <DetailPage width={width} />
        ))}
      </>
    ),
  },
];
