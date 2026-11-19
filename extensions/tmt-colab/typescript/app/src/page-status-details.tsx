import type { ReactNode } from 'react';
import { WorkChipOwner } from '@tmt/browser-ui/work-display';
import { browserUiClasses as ui } from '@tmt/browser-ui/static';
import type { WorkFactView } from './reading-details.js';
import { relativeTime } from './display-time.js';
import { projectTone } from './projects.js';
import { text } from './strings.js';
import { computedLabel, statusReason, WorkPulls, type ChangeBinding } from './work-band-live.js';
import './page-status-details.css';

const t = text.pageBar;

/** What a link reader knows of a page's status (#6679): its manual state and the owner's blocked
 * reason. The computed status, PRs, activity and sections are owner-local. */
export interface ManualStatus {
  state: 'todo' | 'in-progress' | 'done';
  blocked?: string;
}

/**
 * What the row under the page title used to show, now held by the top bar's status chip (#6652):
 * the status and its reason, the page's read-only fields, one line per PR, then its parent and
 * sub-pages. On a phone the same content opens as a sheet and adds the page's projects.
 */
export function PageStatusDetails({
  facts,
  manual,
  blocked,
  owner,
  priority,
  next,
  sections,
  links,
  projects,
  onProjects,
  change,
}: {
  facts?: WorkFactView;
  /** A link reader's status, used without `facts` (#6679): the headline says Blocked and its reason,
   * or the page state; nothing owner-local is shown, not even as unknown. */
  manual?: ManualStatus;
  blocked?: string;
  owner?: { id: string; name: string };
  priority?: 'high' | 'normal' | 'low';
  next?: string;
  sections?: { done: number; total: number };
  /** The parent link and the sub-pages toggle. */
  links?: ReactNode;
  /** The phone sheet's projects line: the names and the picker's opener. */
  projects?: readonly string[];
  onProjects?(from: DOMRect): void;
  /** Ignores or restores a PR matched by the page's number (#6657). */
  change?: ChangeBinding;
}) {
  const state = facts?.state ?? 'unknown';
  const activity = facts?.activity;
  return (
    <div className="page-status-details">
      <p className="page-status-headline">
        {!facts && manual ? (
          manual.blocked ? (
            <>
              <strong>{computedLabel('blocked')}</strong>
              <span>{manual.blocked}</span>
            </>
          ) : (
            <>
              <strong>{t.pageState}</strong>
              <span>{text.workBand.taskState[manual.state]}</span>
            </>
          )
        ) : (
          <>
            <strong>{computedLabel(state, facts)}</strong>
            <span>
              {facts ? statusReason(state, facts, blocked) : text.workBand.statusUnavailable}
            </span>
          </>
        )}
      </p>
      <dl className={`${ui.facts} page-status-fields`}>
        {owner && (
          <>
            <dt>{t.owner}</dt>
            <dd>
              <WorkChipOwner name={owner.name} />
            </dd>
          </>
        )}
        {priority && priority !== 'normal' && (
          <>
            <dt>{t.priority}</dt>
            <dd>{priority === 'high' ? t.priorityHigh : t.priorityLow}</dd>
          </>
        )}
        {next && (
          <>
            <dt>{t.next}</dt>
            <dd>{next}</dd>
          </>
        )}
        {/* A blocked status already says its reason in the headline. */}
        {blocked && state !== 'blocked' && !manual?.blocked && (
          <>
            <dt>{t.blocked}</dt>
            <dd>{blocked}</dd>
          </>
        )}
        {sections && (
          <>
            <dt>{t.sections}</dt>
            <dd>{text.sections.summary(sections.done, sections.total)}</dd>
          </>
        )}
        {facts?.lastActivityAtMs != null && (
          <>
            <dt>{t.lastActivity}</dt>
            <dd>{relativeTime(facts.lastActivityAtMs, facts.asOfMs)}</dd>
          </>
        )}
        {activity && (
          <>
            <dt>{t.ownerActivity}</dt>
            <dd>
              {text.workBand.activityState[activity.state]}
              {/* An unknown activity was never observed: no age beside it (#6675). */}
              {activity.state !== 'unknown' && (
                <>
                  {' · '}
                  {text.workBand.factAge(relativeTime(activity.observedAtMs, facts.asOfMs))}
                </>
              )}
            </dd>
          </>
        )}
      </dl>
      {facts && (
        <div className="page-status-pulls">
          <WorkPulls facts={facts} change={change} />
        </div>
      )}
      {links && <div className="page-status-links">{links}</div>}
      {projects && onProjects && (
        <div className="page-status-projects">
          <span className="page-status-projects-label">{t.projects}</span>
          {projects.map((name) => (
            <span key={name} className="page-bar-label" data-project-tone={projectTone(name)}>
              <span>{name}</span>
            </span>
          ))}
          <button
            type="button"
            className={ui.countChip}
            onClick={(event) => onProjects(event.currentTarget.getBoundingClientRect())}
          >
            {projects.length ? t.editProjects : t.addProject}
          </button>
        </div>
      )}
    </div>
  );
}
