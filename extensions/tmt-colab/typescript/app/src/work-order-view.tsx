import { WorkOrderNotify } from './work-order-notify.js';
import { WorkDragHandle } from '@tmt/browser-ui/work-order';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProjectOrder } from './bootstrap.js';
import type { OrderMove } from './management.js';
import type { PageTransport } from './transport.js';
import type { WorkItem } from './work-home-model.js';

const active = new Set([
  'working',
  'waiting-ci',
  'waiting-release',
  'blocked',
  'needs-you',
  'possibly-stalled',
]);

export function rankedNext(rows: readonly WorkItem[], order?: ProjectOrder) {
  const available = new Map(
    rows
      .filter((row) => !active.has(row.status) && row.status !== 'done')
      .map((row) => [row.key, row]),
  );
  return (order?.items ?? []).flatMap((key) => available.get(key) ?? []);
}

export function WorkOrderView({
  project,
  rows,
  listed,
  omitted,
  transport,
  renderRow,
  refresh,
}: {
  project: string;
  rows: readonly WorkItem[];
  listed: ProjectOrder | undefined;
  omitted: boolean;
  transport: PageTransport;
  refresh: () => void;
  renderRow: (item: WorkItem) => ReactNode;
}) {
  const [order, setOrder] = useState(listed);
  const [assigning, setAssigning] = useState<string>();
  const [directory, setDirectory] = useState<readonly import('./ask-remote.js').RemoteAgent[]>([]);
  const [assignments, setAssignments] = useState(new Map<string, string[]>());
  const [message, setMessage] = useState('');
  const [baseline, setBaseline] = useState<ProjectOrder>();
  const [saving, setSaving] = useState(false);
  const dragged = useRef<string>(undefined);
  const region = useRef<HTMLDivElement>(null);
  const management = transport.management;
  useEffect(() => {
    let live = true;
    function accept(value: ProjectOrder) {
      if (live) setOrder((old) => (!old || value.revision >= old.revision ? value : old));
    }
    if (listed) accept(listed);
    else if (omitted && management?.workOrder) {
      void management.workOrder(project).then(
        (answer) => accept(answer.projectOrder),
        () => {
          if (live) setMessage('Could not load the project order.');
        },
      );
    }
    return () => {
      live = false;
    };
  }, [listed, omitted, project, management]);
  const next = rankedNext(rows, order);
  const ranked = new Set(next.map((row) => row.key));
  const now = rows.filter((row) => active.has(row.status));
  const rest = rows.filter((row) => !active.has(row.status) && !ranked.has(row.key));
  const move = async (item: string, position: OrderMove['position']) => {
    if (!order || !management?.workOrder || saving) return;
    setSaving(true);
    try {
      const answer = await management.workOrder(project, {
        item,
        position,
        revision: order.revision,
      });
      if (!answer.conflict) setBaseline((previous) => previous ?? order);
      setOrder(answer.projectOrder);
      const title = rows.find((row) => row.key === item)?.title ?? item;
      const index = rankedNext(rows, answer.projectOrder).findIndex((row) => row.key === item);
      setMessage(
        answer.conflict
          ? 'The order changed on another device. Review it and try again.'
          : index < 0
            ? title + ' removed from Next.'
            : title + ' moved to position ' + (index + 1) + '.',
      );
      requestAnimationFrame(() =>
        region.current
          ?.querySelector<HTMLElement>('[data-order-key="' + CSS.escape(item) + '"]')
          ?.focus(),
      );
    } catch {
      setMessage('Could not save the project order. Try again.');
    } finally {
      setSaving(false);
    }
  };
  async function assign(row: WorkItem, agent: (typeof directory)[number]) {
    setSaving(true);
    try {
      const snapshot = await transport.page(row.pageId);
      const binding = snapshot.binding;
      try {
        if (row.blockId && binding?.blocks)
          await binding.blocks([
            { op: 'props', id: row.blockId, set: { assignee: agent.name }, unset: [] },
          ]);
        else if (!row.blockId && binding?.metadata && binding.metadataRevision)
          await binding.metadata(
            'page.set',
            { owner: agent.id },
            await binding.metadataRevision(snapshot),
          );
        else throw new Error('Assignment unavailable');
      } finally {
        binding?.close();
      }
      setAssignments((previous) => {
        const changed = new Map(previous);
        for (const name of [row.owner?.name, agent.name])
          if (name) changed.set(name, [...new Set([...(changed.get(name) ?? []), row.title])]);
        return changed;
      });
      setAssigning(undefined);
      refresh();
    } catch {
      setMessage('Could not assign ' + row.title + '.');
    } finally {
      setSaving(false);
    }
  }
  const affected = new Map(assignments);
  if (baseline && order)
    for (const row of rows) {
      if (row.owner && baseline.items.indexOf(row.key) !== order.items.indexOf(row.key))
        affected.set(row.owner.name, [...(affected.get(row.owner.name) ?? []), row.title]);
    }
  return (
    <div ref={region} className="work-order-view">
      {[
        { title: 'Now', items: now },
        { title: 'Next', items: next },
        { title: 'No preference', items: rest },
      ].map(({ title, items }) => (
        <section
          key={title}
          aria-label={title}
          className="work-home-card work-home-project-section"
          onDragOver={(event) => {
            if (title !== 'Now' && dragged.current) event.preventDefault();
          }}
          onDrop={(event) => {
            if (dragged.current && title !== 'Now') {
              event.preventDefault();
              void move(dragged.current, title === 'Next' ? 'last' : 'unrank');
              dragged.current = undefined;
            }
          }}
        >
          <div className="work-home-section-head">
            <h3>
              {title} <span>{items.length}</span>
            </h3>
            {title === 'Next' && transport.orderAgents && (
              <WorkOrderNotify
                key={order?.revision}
                project={project}
                affected={affected}
                remote={transport.orderAgents}
              />
            )}
          </div>
          {!items.length && <p>{title === 'Next' ? 'No ranked items' : 'No items'}</p>}
          {items.map((row, i) => (
            <div
              key={row.key}
              tabIndex={-1}
              data-order-key={row.key}
              className="work-order-row"
              onDrop={(event) => {
                if (title === 'Next' && dragged.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  if (dragged.current !== row.key) void move(dragged.current, { before: row.key });
                  dragged.current = undefined;
                }
              }}
            >
              {title !== 'Now' && order && (
                <WorkDragHandle
                  label={'Drag ' + row.title}
                  onDragStart={(event) => {
                    dragged.current = row.key;
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', row.key);
                  }}
                  onDragEnd={() => {
                    dragged.current = undefined;
                  }}
                />
              )}
              {title === 'Next' && <span>{i + 1}</span>}
              {renderRow(row)}
              {title !== 'Now' && order && (
                <div className="work-order-actions">
                  {transport.orderAgents && (
                    <button
                      onClick={async () => {
                        try {
                          setDirectory(await transport.orderAgents!.listAgents());
                          setAssigning(row.key);
                        } catch {
                          setMessage('Could not load agents.');
                        }
                      }}
                    >
                      {row.owner ? 'Reassign' : 'Assign'}
                    </button>
                  )}
                  {assigning === row.key && (
                    <select
                      aria-label={'Assign ' + row.title}
                      defaultValue=""
                      onChange={(event) => {
                        const agent = directory.find(
                          (candidate) => candidate.id === event.target.value,
                        );
                        if (agent) void assign(row, agent);
                      }}
                    >
                      <option value="">Select an agent</option>
                      {directory.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {title === 'Next' && (
                    <>
                      <button
                        disabled={saving || i === 0}
                        onClick={() => void move(row.key, { before: next[i - 1]!.key })}
                      >
                        Move up
                      </button>
                      <button
                        disabled={saving || i === next.length - 1}
                        onClick={() =>
                          void move(row.key, next[i + 2] ? { before: next[i + 2]!.key } : 'last')
                        }
                      >
                        Move down
                      </button>
                    </>
                  )}
                  <button
                    disabled={saving}
                    onClick={() => void move(row.key, title === 'Next' ? 'unrank' : 'last')}
                  >
                    {title === 'Next' ? 'Remove from Next' : 'Add to Next'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
      <p role="status">{message}</p>
    </div>
  );
}
