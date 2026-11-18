import { ArrowDown, ArrowUp, Ellipsis } from 'lucide-react';
import { useMedia } from './use-media.js';
import { WorkOrderNotify } from './work-order-notify.js';
import { text } from './strings.js';
import { Toast, useToast } from './template-toast.js';
import { WorkDragHandle, WorkRank } from '@tmt/browser-ui/work-order';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProjectOrder } from './bootstrap.js';
import type { OrderMove } from './management.js';
import type { PageTransport } from './transport.js';
import type { WorkItem } from './work-home-model.js';

const t = text.workHome.order;
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
  const compact = useMedia('(max-width: 640px)');
  const [more, setMore] = useState<string>();
  const [order, setOrder] = useState(listed);
  const [assigning, setAssigning] = useState<string>();
  const [directory, setDirectory] = useState<readonly import('./ask-remote.js').RemoteAgent[]>([]);
  const [assignments, setAssignments] = useState(new Map<string, string[]>());
  const [message, setMessage] = useToast();
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
          if (live) setMessage(t.loadFailed);
        },
      );
    }
    return () => {
      live = false;
    };
  }, [listed, omitted, project, management, setMessage]);
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
        answer.conflict ? t.conflict : index < 0 ? t.removed(title) : t.moved(title, index + 1),
      );
      requestAnimationFrame(() =>
        region.current
          ?.querySelector<HTMLElement>('[data-order-key="' + CSS.escape(item) + '"]')
          ?.focus(),
      );
    } catch {
      setMessage(t.saveFailed);
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
      setMessage(t.assignFailed(row.title));
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
        { title: text.workHome.now, items: now },
        { title: t.next, items: next },
        { title: t.rest, items: rest },
      ].map(({ title, items }) => (
        <section
          key={title}
          aria-label={title}
          className="work-home-card work-home-project-section"
          onDragOver={(event) => {
            if (title !== text.workHome.now && dragged.current) event.preventDefault();
          }}
          onDrop={(event) => {
            if (dragged.current && title !== text.workHome.now) {
              event.preventDefault();
              void move(dragged.current, title === t.next ? 'last' : 'unrank');
              dragged.current = undefined;
            }
          }}
        >
          <div className="work-home-section-head">
            <h3>
              {title} <span>{items.length}</span>
            </h3>
            {title !== text.workHome.now && (
              <small>{title === t.next ? t.nextHint : t.restHint}</small>
            )}
            {title === t.next && transport.orderAgents && (
              <WorkOrderNotify
                key={order?.revision}
                project={project}
                affected={affected}
                remote={transport.orderAgents}
              />
            )}
          </div>
          {!items.length && <p>{title === t.next ? t.emptyNext : t.empty}</p>}
          {items.map((row, i) => (
            <div
              key={row.key}
              tabIndex={-1}
              data-order-key={row.key}
              className="work-order-row"
              onDrop={(event) => {
                if (title === t.next && dragged.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  if (dragged.current !== row.key) void move(dragged.current, { before: row.key });
                  dragged.current = undefined;
                }
              }}
            >
              {title !== text.workHome.now && order && (
                <WorkDragHandle
                  label={t.drag(row.title)}
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
              {title === t.next && <WorkRank rank={i + 1} />}
              {renderRow(row)}
              {title !== text.workHome.now && order && (
                <div className="work-order-actions" data-unranked={title === t.rest || undefined}>
                  {assigning === row.key && (
                    <div
                      className="work-assign-menu"
                      role="group"
                      aria-label={t.assignItem(row.title)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setAssigning(undefined);
                          region.current
                            ?.querySelector<HTMLElement>(
                              '[data-order-key="' +
                                CSS.escape(row.key) +
                                '"] button[aria-expanded]',
                            )
                            ?.focus();
                        }
                      }}
                    >
                      {directory.map((agent) => (
                        <button
                          key={agent.id}
                          disabled={saving}
                          onClick={() => void assign(row, agent)}
                        >
                          {agent.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {title === t.next && (
                    <>
                      <button
                        className={compact ? 'work-order-icon' : undefined}
                        aria-label={t.up}
                        disabled={saving || i === 0}
                        onClick={() => void move(row.key, { before: next[i - 1]!.key })}
                      >
                        {compact ? <ArrowUp size={16} /> : t.up}
                      </button>
                      <button
                        className={compact ? 'work-order-icon' : undefined}
                        aria-label={t.down}
                        disabled={saving || i === next.length - 1}
                        onClick={() =>
                          void move(row.key, next[i + 2] ? { before: next[i + 2]!.key } : 'last')
                        }
                      >
                        {compact ? <ArrowDown size={16} /> : t.down}
                      </button>
                    </>
                  )}
                  {compact && (
                    <button
                      className="work-order-icon"
                      aria-label={t.more(row.title)}
                      aria-expanded={more === row.key}
                      onClick={() => {
                        setAssigning(undefined);
                        setMore(more === row.key ? undefined : row.key);
                      }}
                    >
                      <Ellipsis size={16} />
                    </button>
                  )}
                  {(!compact || more === row.key) && (
                    <div
                      className={compact ? 'work-assign-menu' : 'work-order-secondary'}
                      onKeyDown={(event) => {
                        if (compact && event.key === 'Escape') {
                          setMore(undefined);
                          region.current
                            ?.querySelector<HTMLElement>(
                              '[data-order-key="' +
                                CSS.escape(row.key) +
                                '"] .work-order-icon[aria-expanded]',
                            )
                            ?.focus();
                        }
                      }}
                    >
                      {transport.orderAgents && (
                        <button
                          aria-expanded={assigning === row.key}
                          onClick={async () => {
                            setMore(undefined);
                            if (assigning === row.key) {
                              setAssigning(undefined);
                              return;
                            }
                            try {
                              setDirectory(await transport.orderAgents!.listAgents());
                              setAssigning(row.key);
                            } catch {
                              setMessage(t.agentsFailed);
                            }
                          }}
                        >
                          {row.owner ? t.reassign : t.assign}
                        </button>
                      )}
                      <button
                        disabled={saving}
                        onClick={() => {
                          setMore(undefined);
                          void move(row.key, title === t.next ? 'unrank' : 'last');
                        }}
                      >
                        {title === t.next ? t.remove : t.add}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
      <Toast message={message} />
    </div>
  );
}
