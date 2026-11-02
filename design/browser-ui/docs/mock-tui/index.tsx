import { useState } from 'react';
import { Button } from '../../src/ui/index.js';
import { useQuery, setQuery } from '../router.js';
import { TuiFrame } from '../tui/frame.js';
import { framesFor, looks, selectFrame, states } from '../tui/model.js';

export function TuiMock({ path }: { path: string }) {
  const query = useQuery();
  const [open, setOpen] = useState(true);
  const state = query.get('state') ?? 'agents';
  const look = query.get('look') ?? 'tmt';
  const frame = selectFrame(state, look, query.get('size') ?? undefined);
  const available = framesFor(state, look);
  if (path !== '/mock/tui/agents')
    return (
      <main className="docs-main">
        <h1>TUI mock not found</h1>
        <a href="/mock/tui/agents">Agents</a>
      </main>
    );
  return (
    <main className="tui-mock" data-tmt-ui="">
      <header className="tui-mock-heading">
        <div>
          <p className="docs-muted">Ops board · real painter oracle</p>
          <h1>Agents</h1>
        </div>
        <Button
          className="tui-states-toggle"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls="tui-states"
          onClick={() => setOpen(!open)}
        >
          States
        </Button>
      </header>
      <p className="docs-muted">
        Frozen, read-only terminal frames. Choose a state to share its URL; this preview never
        drives a real agent or terminal. The TUI palette remains unchanged.
      </p>
      {open && (
        <section id="tui-states" className="tui-controls" aria-label="States">
          <label>
            State
            <select
              value={state}
              onChange={(event) => setQuery({ state: event.target.value, size: null })}
            >
              {states.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Rendering
            <select value={look} onChange={(event) => setQuery({ look: event.target.value })}>
              {looks.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Terminal size
            <select
              value={frame ? `${frame.width}x${frame.height}` : ''}
              onChange={(event) => setQuery({ size: event.target.value })}
            >
              {available.map((value) => (
                <option
                  key={`${value.width}x${value.height}`}
                  value={`${value.width}x${value.height}`}
                >
                  {value.width} × {value.height} cells
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
      {frame ? (
        <TuiFrame frame={frame} label={state.replaceAll('-', ' ')} />
      ) : (
        <p role="alert">
          No recorded state for this URL. <a href="/mock/tui/agents">Reset to Agents.</a>
        </p>
      )}
      <p className="tui-provenance">
        Source: <code>extensions/tmt-ops/rust/tmt-ops/src/board/home/tests/oracle.json</code>. Each
        selector names an available frozen fixture; no mock-only terminal cells are added.
      </p>
    </main>
  );
}
