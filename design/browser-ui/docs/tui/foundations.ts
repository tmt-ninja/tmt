import { looks } from './looks.js';
import type { NamedSample } from './catalog.js';

export interface LibraryPage {
  slug: string;
  title: string;
  lead: string;
  section: string;
  samples: NamedSample[];
  data?: 'roles' | 'marks';
  note?: string;
}
export const foundations: LibraryPage[] = [
  {
    slug: 'roles',
    title: 'Roles and palette',
    lead: 'Current role values and their recorded truecolour and terminal rendering.',
    section: 'palette',
    data: 'roles',
    samples: [{ label: 'Roles in the Agents workspace', sample: { state: 'overview' } }],
  },
  {
    slug: 'themes',
    title: 'Themes',
    lead: 'The same real painter record in the four available rendering modes.',
    section: 'themes',
    samples: looks.map((look) => ({
      label: look,
      sample: { state: 'agents', look, crop: [0, 15] },
    })),
  },
  {
    slug: 'glyphs',
    title: 'Marks and glyphs',
    lead: 'Source marks alongside the real cells that display them.',
    section: 'marks',
    data: 'marks',
    samples: [{ label: 'Unread and activity marks', sample: { state: 'unread-working' } }],
  },
  {
    slug: 'spacing',
    title: 'Cell spacing',
    lead: 'Recorded terminal columns, rows and component insets, measured in cells.',
    section: 'width-steps',
    samples: [
      { label: 'Header and scope spacing', sample: { state: 'agents', crop: [0, 9] } },
      {
        label: 'A narrow recorded grid',
        sample: { state: 'agents', width: 60, height: 36, crop: [0, 15] },
      },
    ],
  },
  {
    slug: 'width-steps',
    title: 'Width steps',
    lead: 'The same real workspace at recorded terminal column counts.',
    section: 'width-steps',
    samples: [60, 100, 160].map((width) => ({
      label: `${width} recorded columns`,
      sample: { state: 'agents', width, height: 36 },
    })),
  },
  {
    slug: 'motion',
    title: 'Motion',
    lead: 'Captured instants of real usage and loading output; the source owns motion policy.',
    section: 'motion',
    note: 'These are frozen painter instants, not a separately animated prototype.',
    samples: [
      { label: 'Usage instant', sample: { state: 'header-usage', crop: [3, 8] } },
      { label: 'Loading instant', sample: { state: 'conversation-loading', crop: [20, 27] } },
    ],
  },
  {
    slug: 'degradation',
    title: 'Degradation',
    lead: 'The real terminal and no-colour records of the same workspace.',
    section: 'degradation',
    samples: [
      { label: 'Terminal palette', sample: { state: 'agents', look: 'terminal', crop: [0, 15] } },
      { label: 'No colour', sample: { state: 'agents', look: 'NO_COLOR', crop: [0, 15] } },
    ],
  },
];
