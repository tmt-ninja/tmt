import { useState, type ReactNode } from 'react';
import { TuiFrame } from './frame.js';
import { looks, oracle, selectFrame } from './model.js';

function Look({ value, onChange }: { value: string; onChange(value: string): void }) {
  return (
    <label>
      Terminal rendering
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {looks.map((look) => (
          <option key={look}>{look}</option>
        ))}
      </select>
    </label>
  );
}
function Source() {
  return (
    <details className="tui-provenance">
      <summary>Real painter sources and frozen provenance</summary>
      <p>
        These are unchanged Ops HOME oracle cells, decoded by dictionary expansion. No terminal is
        drawn by hand. Terminal and NO_COLOR preserve the painter’s fallback; browser ANSI swatches
        use the theme’s representative ANSI_RGB table. Reset colors use explicit terminal preview
        defaults. They do not follow GUI palette B.
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
function Example({
  state,
  look,
  label,
  crop,
}: {
  state: string;
  look: string;
  label: string;
  crop?: [number, number];
}) {
  const frame = selectFrame(state, look);
  return frame ? (
    <TuiFrame frame={frame} label={label} crop={crop} />
  ) : (
    <p role="alert">
      No recorded frame for {state} / {look}.
    </p>
  );
}
function Roles() {
  const [look, setLook] = useState('tmt');
  return (
    <section className="tui-section">
      <p>
        Roles carry meaning, not a replacement palette. <code>tmt-cli-style::theme</code> resolves
        these same tokens into the real cell style table. The TUI keeps its current palette.
      </p>
      <div className="tui-controls">
        <Look value={look} onChange={setLook} />
      </div>
      <Example
        state="overview"
        look={look}
        label="Agents workspace — the same painter across four renderings"
      />
      <h2>Roles and 16-colour fallback</h2>
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
              <tr key={name}>
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
      <h2>Selection and fallback</h2>
      <p>
        On truecolour selection, words become Text while attention marks retain their semantic
        colour. Terminal selection uses reverse video with a common foreground and bold state marks.
        Track becomes dim without a background. With NO_COLOR, glyphs and labels retain meaning
        without colour. The terminal look uses the terminal’s own sixteen colours, not
        nearest-colour approximations of palette B.
      </p>
      <Source />
    </section>
  );
}
function Glyphs() {
  const [look, setLook] = useState('tmt');
  return (
    <section className="tui-section">
      <p>
        Marks have one meaning across CLI and board output. A mark is not an icon substituted by the
        website. Its exact codepoint comes from the design tokens and the frame remains real painter
        output.
      </p>
      <div className="tui-controls">
        <Look value={look} onChange={setLook} />
      </div>
      <Example state="unread-working" look={look} label="Unread and activity marks in context" />
      <div className="tui-reference-scroll">
        <table className="tui-reference">
          <thead>
            <tr>
              <th>Mark</th>
              <th>Meaning</th>
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
      <h2>Spacing is in cells</h2>
      <p>
        A column is one terminal cell; a row is one line. The style table owns integer padding and
        gaps as [horizontal, vertical], widths, clipping and wrapping. A keycap adds one padding
        cell on either side. The board reserves two leading cells for attention marks in squad tabs.
        A browser frame never reflows those columns: a narrow viewport scrolls the frame.
      </p>
      <Example
        state="agents"
        look={look}
        label="Tabs and key hints — original rows 1–5"
        crop={[0, 5]}
      />
      <Source />
    </section>
  );
}
const componentExamples = [
  ['List rows and selection', 'agents', [5, 15]],
  ['Tabs and chips', 'header-usage', [0, 6]],
  ['Dialog and key hints', 'help', null],
  ['Meter and measurements', 'measure-agent', null],
  ['Footer and input', 'composer-2', [28, 36]],
] as const;
function Components() {
  const [look, setLook] = useState('tmt');
  return (
    <section className="tui-section">
      <p>
        Components are shown in their actual host frame, with original spacing, style runs and
        labels. Cropped examples name their source rows; they are not reconstructed samples.
      </p>
      <div className="tui-controls">
        <Look value={look} onChange={setLook} />
      </div>
      {componentExamples.map(([label, state, crop]) => (
        <Example
          key={state}
          label={label}
          state={state}
          look={look}
          crop={crop ? [...crop] : undefined}
        />
      ))}
      <Source />
    </section>
  );
}
function Patterns() {
  const [look, setLook] = useState('tmt');
  return (
    <section className="tui-section">
      <p>
        Unknown, partial and stale data stay distinguishable from an empty successful result.
        Overflow keeps the terminal’s column geometry. A dialog remains within the painter’s
        terminal grid, while the website scrolls only its frame.
      </p>
      <div className="tui-controls">
        <Look value={look} onChange={setLook} />
      </div>
      {['empty', 'partial', 'stale', 'dense', 'search-agents-all-empty'].map((state) => (
        <Example key={state} state={state} look={look} label={state.replaceAll('-', ' ')} />
      ))}
      <p>
        <a href="/mock/tui/agents">Open the Agents mock</a> to share a particular recorded state,
        look and terminal size in the URL.
      </p>
      <Source />
    </section>
  );
}
export const tuiPages: { slug: string; title: string; lead: string; render(): ReactNode }[] = [
  {
    slug: 'roles',
    title: 'Roles',
    lead: 'Current TUI roles, real cell styles and sixteen-colour fallbacks.',
    render: () => <Roles />,
  },
  {
    slug: 'glyphs',
    title: 'Glyphs & cell spacing',
    lead: 'One meaning per mark. Terminal geometry stays in cells.',
    render: () => <Glyphs />,
  },
  {
    slug: 'components',
    title: 'Components',
    lead: 'Lists, tabs, dialogs, key hints, meters and chips from real painter frames.',
    render: () => <Components />,
  },
  {
    slug: 'patterns',
    title: 'Patterns',
    lead: 'Empty, partial, stale, filtered and overflowing workspace states.',
    render: () => <Patterns />,
  },
];
