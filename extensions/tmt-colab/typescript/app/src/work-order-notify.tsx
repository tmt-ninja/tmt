import { useRef, useState } from 'react';
import type { PageTransport } from './transport.js';
import type { RemoteAgent, SendState } from './ask-remote.js';

export function WorkOrderNotify({
  project,
  affected,
  remote,
}: {
  project: string;
  affected: ReadonlyMap<string, readonly string[]>;
  remote: NonNullable<PageTransport['orderAgents']>;
}) {
  const [agents, setAgents] = useState<RemoteAgent[]>();
  const [selected, setSelected] = useState(new Set<string>());
  const [results, setResults] = useState(new Map<string, SendState['state']>());
  const operations = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = new URL('/colab/work', window.location.origin);
  url.searchParams.set('project', project);
  const message =
    'The work order for ' +
    project +
    ' has changed. Please arrange your work in the current order.\n' +
    url.href;
  const delivered = (id: string) => ['accepted', 'held'].includes(results.get(id) ?? '');
  async function open() {
    setBusy(true);
    try {
      const directory = await remote.listAgents();
      setAgents(directory);
      setSelected(
        new Set(directory.filter((agent) => affected.has(agent.name)).map((agent) => agent.id)),
      );
      setError('');
    } catch {
      setError('Could not load recipients.');
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    setBusy(true);
    try {
      for (const agentId of selected) {
        if (delivered(agentId)) continue;
        const operationId = operations.current.get(agentId) ?? crypto.randomUUID();
        operations.current.set(agentId, operationId);
        let state: SendState['state'];
        try {
          state = (await remote.send({ operationId, agentId, message })).state;
        } catch {
          state = 'uncertain';
        }
        if (state === 'cancelled' || state === 'refused') operations.current.delete(agentId);
        setResults((previous) => new Map(previous).set(agentId, state));
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="work-order-notify">
      <button
        type="button"
        disabled={busy}
        aria-expanded={!!agents}
        onClick={() => (agents ? setAgents(undefined) : void open())}
      >
        Notify
      </button>
      {agents && (
        <fieldset>
          <legend>Recipients</legend>
          {agents.map((agent) => (
            <label key={agent.id}>
              <input
                type="checkbox"
                checked={selected.has(agent.id)}
                disabled={busy || delivered(agent.id)}
                onChange={(event) => {
                  const ids = new Set(selected);
                  if (event.target.checked) ids.add(agent.id);
                  else ids.delete(agent.id);
                  setSelected(ids);
                }}
              />
              {agent.name} {affected.get(agent.name)?.join(', ')} {results.get(agent.id)}
            </label>
          ))}
          <p>{message}</p>
          <button
            type="button"
            disabled={busy || ![...selected].some((id) => !delivered(id))}
            onClick={() => void send()}
          >
            Send
          </button>
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
