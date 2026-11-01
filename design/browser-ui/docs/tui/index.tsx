import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePreview } from '../preview.js';
import { tuiMockBase } from '../routes.js';
import { patternDocs, type PatternDoc } from './patterns.js';
import { TuiPreview } from './preview.js';
import { looks, oracle } from './model.js';
import {
  cliStyle,
  componentDocs,
  locatePart,
  resolveSample,
  stateKinds,
  stateLabels,
  tuiRoot,
  type ComponentDoc,
  type NamedSample,
  type TuiGroup,
} from './catalog.js';

export { tuiRoot } from './catalog.js';
export const agentsMockPath = `${tuiMockBase}/agents`;
let fallback = false;
const listeners = new Set<() => void>();
function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}
function useFallback() {
  return useSyncExternalStore(subscribe, () => fallback);
}
function useTuiLook() {
  const { theme } = usePreview();
  return useFallback() ? 'terminal' : theme === 'light' ? 'tmt-light' : 'tmt';
}
/** The shell owns placement beside its theme toggle; this pack owns terminal fallback. */
export function TuiControls() {
  const checked = useFallback();
  return (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          fallback = event.target.checked;
          for (const notify of listeners) notify();
        }}
      />
      16-colour fallback
    </label>
  );
}
function Rules({ section }: { section: string }) {
  return (
    <p className="tui-rule-link">
      <a href={cliStyle(section)}>Canonical rules: cli-style.md · {section.replaceAll('-', ' ')}</a>
    </p>
  );
}
function Source() {
  return (
    <details className="tui-provenance">
      <summary>Frozen painter provenance</summary>
      <p>
        Preview cells and styles come unchanged from the Ops oracle. Labels use original row and
        cell coordinates. Missing recordings are listed explicitly.
      </p>
      <ul>
        {oracle.provenance.map((source) => (
          <li key={source.path}>
            <code>{source.path}</code>
            <br />
            <code>sha256 {source.sha256}</code>
            {'fields' in source && source.fields && (
              <span> · {source.fields.join(', ')} subset</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
function RoleData() {
  return (
    <div className="tui-reference-scroll">
      <table className="tui-reference">
        <thead>
          <tr>
            <th>Role</th>
            <th>Use</th>
            <th>Dark</th>
            <th>Light</th>
            <th>16 colours</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(oracle.roles).map(([name, role]) => (
            <tr key={name} id={`role-${name}`}>
              <td>
                <code>{name}</code>
              </td>
              <td>{role.use}</td>
              <td>
                <span className="tui-swatch" style={{ background: role.dark }} />
                {role.dark}
              </td>
              <td>
                <span className="tui-swatch" style={{ background: role.light }} />
                {role.light}
              </td>
              <td>{role.terminal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function MarkData() {
  return (
    <div className="tui-reference-scroll">
      <table className="tui-reference">
        <thead>
          <tr>
            <th>Mark</th>
            <th>Source meaning</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(oracle.marks).map(([mark, meaning]) => (
            <tr key={mark}>
              <td>
                <code>{mark}</code>
              </td>
              <td>{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ComponentPage({ doc }: { doc: ComponentDoc }) {
  const look = useTuiLook();
  const [state, setState] = useState(0);
  const { frame, from, to } = resolveSample(doc.anatomy, look);
  const selected = doc.states[state]!;
  const missing = stateKinds.filter((kind) => !doc.states.some((entry) => entry.kind === kind));
  return (
    <section
      className="tui-component"
      data-tui-component={doc.slug}
      data-tui-source-module={doc.module}
    >
      <p className="docs-muted">
        {doc.family === 'Ops'
          ? 'Ops application surface. These frames show its real application composition.'
          : 'Reusable tmt-tui component. Recorded examples show the real Ops composition; they do not claim its painter calls this widget.'}
      </p>
      <p className="docs-muted">
        Source:{' '}
        {doc.source.map((path, index) => (
          <span key={path}>
            {index > 0 && ' · '}
            <a href={`https://github.com/tmt-ninja/tmt/blob/main/${path}`}>
              <code>{path}</code>
            </a>
          </span>
        ))}
      </p>
      {doc.evidenceNote && <p className="tui-missing">{doc.evidenceNote}</p>}
      <section data-tui-anatomy="">
        <h2>Anatomy</h2>
        <TuiPreview sample={doc.anatomy} look={look} label={`${doc.title} anatomy`} />
        <p className="docs-muted">
          Part labels refer to the original terminal cell coordinates; the cells are unchanged.
        </p>
        <ol className="tui-part-list">
          {doc.parts.map((part) => {
            const position = locatePart(frame, part);
            if (part.row <= from || part.row > to)
              throw new Error(`Anatomy part outside visible rows: ${doc.slug}/${part.name}`);
            return (
              <li key={part.name}>
                <b>{part.name}</b> · <code>{part.text}</code> · row {position.row}, cells{' '}
                {position.column}–{position.end}
              </li>
            );
          })}
        </ol>
      </section>
      <section data-tui-variants="">
        <h2>Variants</h2>
        <dl>
          {doc.variants.map((variant) => (
            <div key={variant.name}>
              <dt>
                <b>{variant.name}</b>
              </dt>
              <dd>{variant.description}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section data-tui-states="">
        <h2>States</h2>
        <div className="tui-controls">
          <label>
            Recorded state
            <select value={state} onChange={(event) => setState(Number(event.target.value))}>
              {doc.states.map((entry, index) => (
                <option key={`${entry.kind}-${entry.label}-${index}`} value={index}>
                  {stateLabels[entry.kind]} · {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <TuiPreview sample={selected.sample} look={look} label={selected.label} />
      </section>
      <section className="tui-missing">
        <h2>Missing frames</h2>
        {missing.length ? (
          <ul>
            {missing.map((kind) => (
              <li key={kind}>
                <b>{stateLabels[kind]}:</b> no separate recording for this component in the frozen
                selection.
              </li>
            ))}
          </ul>
        ) : (
          <p>All listed state categories have a recorded example.</p>
        )}
      </section>
      <section>
        <h2>Keys</h2>
        {doc.keys.length ? (
          <ul className="tui-key-list">
            {doc.keys.map((key) => (
              <li key={key}>
                <kbd>{key}</kbd>
              </li>
            ))}
          </ul>
        ) : (
          <p>No component-owned key binding in this recording.</p>
        )}
        <p className="docs-muted">
          These are the captured host’s keys. The linked rule and its effective help own their
          meaning.
        </p>
      </section>
      <section>
        <h2>Roles</h2>
        <ul className="tui-role-list">
          {doc.roles.map((role) => (
            <li key={role}>
              <a href={`${tuiRoot}/roles#role-${role}`}>
                <code>{role}</code>
              </a>
            </li>
          ))}
        </ul>
      </section>
      <Rules section={doc.section} />
      <Source />
    </section>
  );
}
interface LibraryPage {
  slug: string;
  title: string;
  lead: string;
  section: string;
  samples: NamedSample[];
  data?: 'roles' | 'marks';
  note?: string;
}
const foundations: LibraryPage[] = [
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
function PatternPageView({ doc }: { doc: PatternDoc }) {
  const look = useTuiLook();
  const { frame } = resolveSample(doc.anatomy.sample, look);
  return (
    <section className="tui-section" data-tui-pattern={doc.slug}>
      <section>
        <h2>Problem</h2>
        <p>{doc.problem}</p>
      </section>
      <section>
        <h2>Anatomy</h2>
        <TuiPreview {...doc.anatomy} look={look} />
        <ol className="tui-part-list">
          {doc.anatomy.parts.map((part) => {
            const position = locatePart(frame, part);
            return (
              <li key={part.name}>
                <b>{part.name}</b> · <code>{part.text}</code> · row {position.row}, cells{' '}
                {position.column}–{position.end}
              </li>
            );
          })}
        </ol>
      </section>
      <section>
        <h2>Rules</h2>
        <ul>
          {doc.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <Rules section={doc.section} />
      </section>
      <section>
        <h2>Variants and states</h2>
        {doc.samples.map((entry) => (
          <TuiPreview key={entry.label} {...entry} look={look} />
        ))}
        {doc.missing && <p className="tui-missing">{doc.missing}</p>}
      </section>
      <section>
        <h2>Links</h2>
        <ul>
          {doc.links.map((link) => (
            <li key={link.slug}>
              <a href={`${tuiRoot}/${link.slug}`}>{link.title}</a>
            </li>
          ))}
        </ul>
        {doc.slug === 'agents-board' && (
          <p>
            <a href={agentsMockPath}>Open the Agents mock</a>
          </p>
        )}
      </section>
      <Source />
    </section>
  );
}
function LibraryPageView({ doc }: { doc: LibraryPage }) {
  const look = useTuiLook();
  return (
    <section className="tui-section">
      {doc.note && <p>{doc.note}</p>}
      {doc.samples.map((entry) => (
        <TuiPreview key={entry.label} {...entry} look={look} />
      ))}
      {doc.data === 'roles' && <RoleData />}
      {doc.data === 'marks' && (
        <>
          <MarkData />
          <p>
            Status marks describe state; <a href={`${tuiRoot}/chip`}>Chip variants</a> add count or
            state labels.
          </p>
        </>
      )}
      <Rules section={doc.section} />
      <Source />
    </section>
  );
}
export interface TuiPage {
  slug: string;
  title: string;
  lead: string;
  group: TuiGroup;
  render(): ReactNode;
}
export const tuiPages: TuiPage[] = [
  ...foundations.map((doc) => ({
    ...doc,
    group: 'Foundations' as const,
    render: () => <LibraryPageView doc={doc} />,
  })),
  ...componentDocs.map((doc) => ({
    slug: doc.slug,
    title: doc.title,
    lead: doc.lead,
    group: 'Components' as const,
    render: () => <ComponentPage doc={doc} />,
  })),
  ...patternDocs.map((doc) => ({
    ...doc,
    group: 'Patterns' as const,
    render: () => <PatternPageView doc={doc} />,
  })),
];
