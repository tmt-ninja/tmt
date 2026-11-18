import {
  Button,
  Checkbox,
  Popover,
  PopoverContent,
  PopoverTrigger,
  UiTheme,
} from '@tmt/browser-ui/ui';
import { BrowserAvatar } from '@tmt/browser-ui/react';
import { getTheme, subscribeTheme } from './theme.js';
import { text } from './strings.js';
import { useRef, useState, useSyncExternalStore } from 'react';
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
  const t = text.workHome.order;
  const quote = t.quote(project);
  const message = quote + '\n' + url.href;
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as const);
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
      setError(t.recipientsFailed);
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
      <UiTheme theme={theme}>
        <Popover
          open={!!agents}
          onOpenChange={(next) => (next ? void open() : setAgents(undefined))}
        >
          <PopoverTrigger asChild>
            <Button size="sm" disabled={busy}>
              {t.notify}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="work-notify-card" aria-label={t.recipients}>
            <strong>{t.recipients}</strong>
            {agents?.map((agent) => {
              const changes = affected.get(agent.name);
              const result = results.get(agent.id);
              return (
                <label key={agent.id} title={changes?.join(', ')}>
                  <Checkbox
                    aria-label={agent.name}
                    aria-description={changes?.join(', ')}
                    checked={selected.has(agent.id)}
                    disabled={busy || delivered(agent.id)}
                    onCheckedChange={(checked) =>
                      setSelected((previous) => {
                        const ids = new Set(previous);
                        if (checked === true) ids.add(agent.id);
                        else ids.delete(agent.id);
                        return ids;
                      })
                    }
                  />
                  <BrowserAvatar name={agent.name} kind="agent" size="s" decorative />
                  <span>
                    {agent.name}
                    {changes?.length ? <small>{t.changed(changes.length)}</small> : null}
                  </span>
                  {result && <small role="status">{t.results[result]}</small>}
                </label>
              );
            })}
            <blockquote>{quote}</blockquote>
            <Button
              size="sm"
              disabled={busy || ![...selected].some((id) => !delivered(id))}
              onClick={() => void send()}
            >
              {t.send}
            </Button>
          </PopoverContent>
        </Popover>
      </UiTheme>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
