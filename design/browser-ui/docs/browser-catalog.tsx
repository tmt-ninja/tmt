import type { ComponentType } from 'react';
import { ChartsSection } from '../gallery/charts.js';
import {
  ActionsSection,
  BrandSection,
  BusySection,
  CheckboxSection,
  ChipsSection,
  CommandSection,
  FieldsSection,
  HeaderSection,
  IconActionsSection,
  ListSection,
  MenusSection,
  NoticeSection,
  TabsSection,
  ToggleSection,
} from '../gallery/components.js';
import { covered, type SectionId } from '../gallery/covered.js';
import { EditorialSection } from '../gallery/editorial.js';
import { NotificationsSection, OverlaysSection, ShellSection } from '../gallery/frames.js';
import {
  DisclosureSection,
  PageSectionsSection,
  TablesSection,
  VisuallyHiddenSection,
} from '../gallery/layout.js';
import {
  AvatarSection,
  CardSection,
  ChoiceSection,
  CountChipSection,
  OverviewSection,
  PagerSection,
  StatusTileSection,
} from '../gallery/pieces.js';

/**
 * The Browser components (#5821 B): the `@tmt/browser-ui/react` parts and the static classes
 * products use today. Each entry renders the gallery's own section, every demo in light and dark
 * side by side, so the docs and the gallery cannot drift. `css` names the src/*.css modules the
 * entry shows; test/docs-coverage.test.ts holds every public export and module to an entry.
 */
export interface BrowserDoc {
  slug: string;
  name: string;
  section: SectionId;
  description: string;
  Demo: ComponentType;
  css: string[];
}

export const browserDocs: BrowserDoc[] = [
  {
    slug: 'brand',
    name: 'Brand mark',
    section: 'brand',
    description: 'The tmt mark and the lockup with the wordmark, drawn from the brand-mark roles.',
    Demo: BrandSection,
    css: ['brand-mark'],
  },
  {
    slug: 'shell',
    name: 'Shell and rail',
    section: 'shell',
    description:
      'The product frame: the top bar, the module rail with its menus, counts and attention dot, and the content slot. Hover and drag reveal row actions with the swap crossfade.',
    Demo: ShellSection,
    css: ['shell', 'swap'],
  },
  {
    slug: 'header',
    name: 'Header',
    section: 'header',
    description: 'The page header: title, caption and actions on the header metrics.',
    Demo: HeaderSection,
    css: ['header'],
  },
  {
    slug: 'action',
    name: 'Action',
    section: 'actions',
    description:
      'The Browser action button in its primary, secondary, text and danger variants, with busy and disabled states.',
    Demo: ActionsSection,
    css: ['action'],
  },
  {
    slug: 'icon-action',
    name: 'Icon action',
    section: 'icon-actions',
    description: 'A square action named by its tooltip label; text and filled variants.',
    Demo: IconActionsSection,
    css: ['icon-action'],
  },
  {
    slug: 'busy-mark',
    name: 'Busy mark',
    section: 'busy',
    description:
      'The busy dots. useBusyMark waits busyMarkDelayMs before showing and holds busyMarkHoldMs once shown, so a quick action never flickers.',
    Demo: BusySection,
    css: ['spinner'],
  },
  {
    slug: 'field',
    name: 'Field',
    section: 'fields',
    description: 'A labelled control with its help and error text and the field edge and focus.',
    Demo: FieldsSection,
    css: ['field'],
  },
  {
    slug: 'toggle',
    name: 'Toggle',
    section: 'toggle',
    description: 'A pressed or unpressed action, for a view setting that stays on.',
    Demo: ToggleSection,
    css: ['toggle'],
  },
  {
    slug: 'browser-checkbox',
    name: 'Checkbox (Browser)',
    section: 'checkbox',
    description: 'The Browser checkbox with its label, mixed and disabled states.',
    Demo: CheckboxSection,
    css: ['checkbox'],
  },
  {
    slug: 'browser-chips',
    name: 'Chips (Browser)',
    section: 'chips',
    description:
      'Chips with an add popup and remove controls, and state chips with a mark and word.',
    Demo: ChipsSection,
    css: ['chips'],
  },
  {
    slug: 'count-chip',
    name: 'Count chip',
    section: 'count-chip',
    description: 'A number with its tone: neutral, waiting or blocked; countText formats it.',
    Demo: CountChipSection,
    css: ['count-chip'],
  },
  {
    slug: 'avatar',
    name: 'Avatar',
    section: 'avatar',
    description: 'Initials on a seat colour for a person or agent; avatarInitials derives them.',
    Demo: AvatarSection,
    css: ['avatar'],
  },
  {
    slug: 'choice',
    name: 'Choice',
    section: 'choice',
    description: 'Single and multiple choice rows for a question, with an Other answer.',
    Demo: ChoiceSection,
    css: ['choice'],
  },
  {
    slug: 'pager',
    name: 'Pager',
    section: 'pager',
    description: 'Previous and next with the position, for a list longer than a page.',
    Demo: PagerSection,
    css: ['pager'],
  },
  {
    slug: 'status-tile',
    name: 'Status tile',
    section: 'status-tile',
    description: 'A state with its mark, word and count, alone or as a row of tiles.',
    Demo: StatusTileSection,
    css: ['status-tile', 'state-mark'],
  },
  {
    slug: 'card-meter',
    name: 'Card and meter',
    section: 'card',
    description: 'The static card with a meter and its glyphs and a small chart.',
    Demo: CardSection,
    css: ['card', 'meter'],
  },
  {
    slug: 'overview',
    name: 'Overview pieces',
    section: 'overview',
    description:
      'The page head, banner, facts, stats and state marks an overview page composes, with the shared glyphs.',
    Demo: OverviewSection,
    css: ['page-head', 'banner', 'facts', 'stats', 'state-mark', 'glyph'],
  },
  {
    slug: 'menu',
    name: 'Menu',
    section: 'menus',
    description:
      'The Browser menu and its host for non-React pages: items, radio and checkbox items, disabled rows and submenus.',
    Demo: MenusSection,
    css: ['menu'],
  },
  {
    slug: 'browser-tabs',
    name: 'Tabs (Browser)',
    section: 'tabs',
    description:
      'The Browser tabs with counts and wrapping. New work uses the ui Tabs and its TabsBar.',
    Demo: TabsSection,
    css: ['tabs'],
  },
  {
    slug: 'list',
    name: 'List and list table',
    section: 'list',
    description:
      'Rows with a lead, title, meta and actions, the list table with its column rules and the page subheader.',
    Demo: ListSection,
    css: ['list'],
  },
  {
    slug: 'section',
    name: 'Section',
    section: 'section',
    description: 'A titled page section with its rule and spacing.',
    Demo: PageSectionsSection,
    css: ['section'],
  },
  {
    slug: 'table',
    name: 'Table',
    section: 'table',
    description: 'A data table with its header, numeric columns and compact scroll.',
    Demo: TablesSection,
    css: ['table'],
  },
  {
    slug: 'editorial',
    name: 'Editorial prose',
    section: 'editorial',
    description: 'Long-form prose on the type ramp: headings, lists, quotes, code and tables.',
    Demo: EditorialSection,
    css: ['editorial'],
  },
  {
    slug: 'disclosure',
    name: 'Disclosure',
    section: 'disclosure',
    description: 'A summary that opens more detail in place.',
    Demo: DisclosureSection,
    css: ['disclosure'],
  },
  {
    slug: 'visually-hidden',
    name: 'Visually hidden',
    section: 'visually-hidden',
    description: 'Text for assistive technology only, such as a count’s full sentence.',
    Demo: VisuallyHiddenSection,
    css: ['visually-hidden'],
  },
  {
    slug: 'browser-command',
    name: 'Command (Browser)',
    section: 'command',
    description: 'The command field with its results list and keyboard selection.',
    Demo: CommandSection,
    css: ['command'],
  },
  {
    slug: 'notice',
    name: 'Notice',
    section: 'notice',
    description: 'A card-level message with a tone mark, heading, body and actions.',
    Demo: NoticeSection,
    css: ['notice'],
  },
  {
    slug: 'dialog-drawer-panel',
    name: 'Dialog, drawer and panel',
    section: 'overlays',
    description:
      'The Browser dialog (modal and confirm), drawer and non-modal panel, with the drawer header, Esc and focus return.',
    Demo: OverlaysSection,
    css: ['dialog', 'drawer', 'panel'],
  },
  {
    slug: 'notifications',
    name: 'Notifications',
    section: 'notifications',
    description: 'Transient notifications stacked at the corner, with their actions and dismissal.',
    Demo: NotificationsSection,
    css: ['notifications'],
  },
  {
    slug: 'chart',
    name: 'Chart',
    section: 'charts',
    description: 'Bar, line and stacked charts on the chart roles, with axes, legend and tooltip.',
    Demo: ChartsSection,
    css: ['chart'],
  },
];

/** The `@tmt/browser-ui/react` exports an entry covers, through the gallery's own map. */
export const browserExports = (doc: BrowserDoc) =>
  Object.entries(covered)
    .filter(([, section]) => section === doc.section)
    .map(([name]) => name);
