import { BrowserAvatar } from '../src/react.js';
import { WorkDragHandle, WorkNextLine } from '../src/work-order.js';
import { Cell, Cells, Pair, Section } from './kit.js';

type State =
  | 'working'
  | 'possibly-stalled'
  | 'waiting-ci'
  | 'needs-you'
  | 'blocked'
  | 'discussing'
  | 'done';

const rows: {
  state: State;
  number: string;
  title: string;
  next: string;
  owner: string;
  time: string;
  high?: boolean;
}[] = [
  {
    state: 'blocked',
    number: 'COLAB-119',
    title: 'Batch reads for large design pages',
    next: 'Blocked: waiting for Core to decide the protocol',
    owner: 'gui-2',
    time: '1 day',
    high: true,
  },
  {
    state: 'needs-you',
    number: 'COLAB-140',
    title: 'A Colab page is the work',
    next: 'Needs you: answer 4 questions',
    owner: 'tmt-gui-lead',
    time: '10 min',
    high: true,
  },
  {
    state: 'working',
    number: 'COLAB-143',
    title: 'Mockup toolbar has no spacing',
    next: 'PR #6470 in review',
    owner: 'gui-3',
    time: '3 min',
  },
  {
    state: 'possibly-stalled',
    number: 'OPS-37',
    title: 'Delete the timing-only tests',
    next: 'Possibly stalled: idle 3 hours, asked once',
    owner: 'gui-3',
    time: '3 h',
  },
  {
    state: 'waiting-ci',
    number: 'OPS-33',
    title: 'The You tag on messages',
    next: 'Waiting for CI · PR #6461',
    owner: 'gui-2',
    time: '20 min',
  },
];

const counts: [State, number, string][] = [
  ['working', 6, 'In progress'],
  ['waiting-ci', 2, 'Waiting for CI or release'],
  ['needs-you', 3, 'Needs you'],
  ['blocked', 1, 'Blocked'],
  ['possibly-stalled', 1, 'Possibly stalled'],
  ['discussing', 0, 'Discussing'],
];

function Ratio({ label }: { label: string }) {
  return (
    <div className="tmt-ui-work-ratio" role="img" aria-label={label}>
      {counts
        .filter(([, count]) => count > 0)
        .map(([state, count]) => (
          <span key={state} data-state={state} style={{ flexGrow: count }} />
        ))}
    </div>
  );
}

const week: [string, number][] = [
  ['Mon', 2],
  ['Tue', 4],
  ['Wed', 1],
  ['Thu', 5],
  ['Fri', 3],
  ['Sat', 3],
  ['Today', 3],
];

/** The Work home parts (#6474), drawn as the spec's Work home mockup draws them. */
export function WorkSection() {
  const busiest = Math.max(...week.map(([, count]) => count));
  return (
    <Section id="work">
      <Pair title="Order drag handle" note="Drag a ranked Work item to its new position.">
        {() => <WorkDragHandle label="Move item" onDragStart={() => {}} />}
      </Pair>
      <Pair title="Next line" note="The first three ranked items below a project.">
        {() => <WorkNextLine titles={['Title fields', 'Computed status', 'Work home']} />}
      </Pair>
      <Pair
        title="Work row"
        note="One work item in a project section: status dot, number, priority and title, next step, owner and time since its last activity. Under the compact width the title leads and the number, owner and time share a last line."
        stacked
      >
        {() => (
          <div>
            {rows.map((row) => (
              <a className="tmt-ui-work-row" href="#work" key={row.number}>
                <span className="tmt-ui-work-dot" data-state={row.state} aria-hidden="true" />
                <span className="tmt-ui-work-number">{row.number}</span>
                <span className="tmt-ui-work-title">
                  {row.high ? <span className="tmt-ui-work-priority">High</span> : null}
                  {row.title}
                </span>
                <span className="tmt-ui-work-next">{row.next}</span>
                <span className="tmt-ui-work-owner">
                  <BrowserAvatar name={row.owner} kind="agent" size="s" decorative />
                  <span>{row.owner}</span>
                </span>
                <span className="tmt-ui-work-time">{row.time}</span>
              </a>
            ))}
          </div>
        )}
      </Pair>
      <Pair
        title="Status overview and status ratio bar"
        note="How many open items are in each status; a count that filters the list is a button, the chosen one pressed. The ratio bar gives each status a segment as wide as its count."
      >
        {() => (
          <Cells>
            <Cell label="counts, the first one chosen">
              <div style={{ display: 'grid', gap: '14px' }}>
                <ul className="tmt-ui-work-overview" aria-label="Open work by status">
                  {counts.map(([state, count, word], index) => (
                    <li key={state}>
                      <button
                        type="button"
                        className="tmt-ui-work-count"
                        aria-pressed={index === 0}
                        data-zero={count === 0 ? '' : undefined}
                      >
                        <span className="tmt-ui-work-count-number">{count}</span>
                        <span className="tmt-ui-work-count-label">
                          <span className="tmt-ui-work-dot" data-state={state} aria-hidden="true" />
                          {word}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Ratio label="6 in progress, 2 waiting for CI or release, 3 need you, 1 blocked, 1 possibly stalled" />
              </div>
            </Cell>
          </Cells>
        )}
      </Pair>
      <Pair
        title="Done-count chart"
        note="Items done per period cell, bars scaled to the busiest cell, today darker. A cell that filters Recently done is a button."
      >
        {() => (
          <ul className="tmt-ui-work-done" aria-label="Done in the last 7 days">
            {week.map(([day, count], index) => (
              <li key={day}>
                <button
                  type="button"
                  className="tmt-ui-work-done-cell"
                  aria-label={`${day}: ${count} done`}
                  aria-pressed={false}
                  data-current={index === week.length - 1 ? '' : undefined}
                >
                  <span className="tmt-ui-work-done-track">
                    <span aria-hidden="true">{count}</span>
                    <span
                      className="tmt-ui-work-done-bar"
                      style={{ height: `${(count / busiest) * 80}%` }}
                    />
                  </span>
                  <span aria-hidden="true">{day}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Pair>
      <Pair
        title="Field chips"
        note="A page's title row: the status (bold, opens its reason), priority, owner, PR and parent. Passive chips are spans."
      >
        {() => (
          <div className="tmt-ui-field-chips">
            <button type="button" className="tmt-ui-field-chip" data-status="">
              <span className="tmt-ui-work-dot" data-state="needs-you" aria-hidden="true" />
              <span>Needs you ▾</span>
            </button>
            <span className="tmt-ui-field-chip">
              <span className="tmt-ui-field-chip-key">Priority</span>
              <span>High</span>
            </span>
            <span className="tmt-ui-field-chip">
              <BrowserAvatar name="gui-3" kind="agent" size="s" decorative />
              <span>gui-3</span>
            </span>
            <span className="tmt-ui-field-chip">
              <span className="tmt-ui-field-chip-key">PR</span>
              <span>#6457 merged</span>
            </span>
            <span className="tmt-ui-field-chip">
              <span className="tmt-ui-field-chip-key">Parent</span>
              <span>Colab stability</span>
            </span>
            <span className="tmt-ui-field-chip">
              <span>3 sub-pages</span>
            </span>
          </div>
        )}
      </Pair>
    </Section>
  );
}
