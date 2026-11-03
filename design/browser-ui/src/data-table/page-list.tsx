import type { ReactNode } from 'react';
import { Archive, ArchiveRestore, FileText, MoreHorizontal, Pin, Plus } from 'lucide-react';
import { Badge } from '../ui/badge.js';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert.js';
import { Skeleton } from '../ui/skeleton.js';
import { Button } from '../ui/button.js';
import { TrustedMenuItem, TrustedMenuCheckboxItem } from '../ui/trusted-menu.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Surface } from '../ui/surface.js';
import { Tabs, TabsBar, TabsContent, TabsList, TabsTrigger } from '../ui/tabs.js';
import './page-list.css';

/** Stable project colour, as in the Colab list mock. */
function projectHue(name: string) {
  return `var(--tmt-ui-color-series-${([...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 6) + 1})`;
}
export function PageListProjectChip({ name }: { name: string }) {
  return (
    <Badge variant="outline" className="tmt-page-list-project">
      <span
        className="tmt-page-list-project-dot"
        style={{ background: projectHue(name) }}
        aria-hidden="true"
      />
      {name}
    </Badge>
  );
}
export function PageListStageChip({ stage, label }: { stage: string; label: string }) {
  return (
    <Badge variant="outline" className="tmt-page-list-stage" data-stage={stage}>
      <span className="tmt-page-list-stage-dot" aria-hidden="true" />
      {label}
    </Badge>
  );
}
export interface PageListPin {
  id: string;
  /** The caller supplies its real page link and navigation behavior. */
  title: ReactNode;
  projects: readonly string[];
  stage?: ReactNode;
}
export function PageListPins({ label, pages }: { label: string; pages: readonly PageListPin[] }) {
  if (!pages.length) return null;
  return (
    <ul className="tmt-page-list-pins" aria-label={label}>
      {pages.map((page) => (
        <li key={page.id}>
          <Surface level="sheet" className="tmt-page-list-pin">
            <FileText className="tmt-page-list-pin-icon" aria-hidden="true" />
            <div>
              {page.title}
              <div className="tmt-page-list-pin-meta">
                {page.projects.map((name) => (
                  <PageListProjectChip key={name} name={name} />
                ))}
                {page.stage && <span className="tmt-page-list-pin-stage">{page.stage}</span>}
              </div>
            </div>
            <Pin className="tmt-page-list-pin-mark" aria-hidden="true" />
          </Surface>
        </li>
      ))}
    </ul>
  );
}

export interface PageListView {
  id: string;
  label: string;
  count?: number;
  state?: { mark: string; word: string };
}

/** Controlled views and actions; the host owns counts, navigation and panel content. */
export function PageListTabs({
  label,
  value,
  views,
  onChange,
  formatCount,
  disabled = false,
  actions,
  children,
}: {
  label: string;
  value: string;
  views: readonly PageListView[];
  onChange(value: string): void;
  formatCount(value: number): string;
  disabled?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsBar className="tmt-page-list-tabs-row" actions={actions}>
        <TabsList variant="line" className="tmt-page-list-tabs" aria-label={label}>
          {views.map((view) => (
            <TabsTrigger
              key={view.id}
              value={view.id}
              disabled={disabled}
              aria-label={`${view.state ? `${view.state.mark} ` : ''}${view.label}${view.count === undefined ? '' : `, ${formatCount(view.count)}`}${view.state ? ` · ${view.state.word}` : ''}`}
            >
              {view.label}{' '}
              {view.count !== undefined && (
                <span className="tmt-page-list-count">{formatCount(view.count)}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </TabsBar>
      <TabsContent value={value}>{children}</TabsContent>
    </Tabs>
  );
}

/** The shared sticky control row; the host supplies its search and filter commands. */
export function PageListControls({
  search,
  filter,
  sort,
  trailing,
  className,
  stuck = false,
}: {
  search: ReactNode;
  filter: ReactNode;
  sort: ReactNode;
  trailing?: ReactNode;
  className?: string;
  stuck?: boolean;
}) {
  return (
    <div
      className={['tmt-page-list-controls', className].filter(Boolean).join(' ')}
      data-stuck={stuck || undefined}
    >
      <div className="tmt-page-list-controls-search">{search}</div>
      {filter}
      {sort}
      {trailing}
    </div>
  );
}

export interface PageListProjectChoice {
  name: string;
  checked: boolean | 'indeterminate';
  disabledReason?: string;
}

/** The host owns the selected pages and confirmation of destructive actions. */
export function PageListBulkActions({
  projects,
  canArchive,
  canRestore,
  onProject,
  onNewProject,
  onArchive,
  onRestore,
  onDelete,
}: {
  projects: readonly PageListProjectChoice[];
  canArchive: boolean;
  canRestore: boolean;
  onProject(name: string, checked: boolean): void;
  onNewProject(): void;
  onArchive(): void;
  onRestore(): void;
  onDelete(): void;
}) {
  return (
    <>
      {canArchive && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            if (event.nativeEvent.isTrusted) onArchive();
          }}
        >
          <Archive aria-hidden="true" /> Archive
        </Button>
      )}
      {canRestore && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            if (event.nativeEvent.isTrusted) onRestore();
          }}
        >
          <ArchiveRestore aria-hidden="true" /> Restore
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            Projects…
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {projects.map((project) => (
            <TrustedMenuCheckboxItem
              key={project.name}
              checked={project.checked}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => onProject(project.name, checked === true)}
            >
              {project.name}
            </TrustedMenuCheckboxItem>
          ))}
          {projects.length > 0 && <DropdownMenuSeparator />}
          <TrustedMenuItem onSelect={onNewProject}>New project…</TrustedMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" aria-label="More">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <TrustedMenuItem variant="destructive" onSelect={onDelete}>
            Delete
          </TrustedMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Menu items only; the table owns the trigger and the host owns every action. */
export function PageListRowMenu({
  archived,
  readOnly,
  pinned,
  onOpenInNewTab,
  onPin,
  onManage,
  onProjects,
  onArchive,
  onDelete,
  onCopyId,
  footer,
}: {
  archived: boolean;
  readOnly: boolean;
  pinned?: boolean;
  onOpenInNewTab(): void;
  onPin?(): void;
  onManage(): void;
  onProjects(): void;
  onArchive(): void;
  onDelete(): void;
  onCopyId?(): void;
  footer?: ReactNode;
}) {
  const reason = readOnly ? 'Read-only access' : undefined;
  return (
    <>
      <TrustedMenuItem onSelect={onOpenInNewTab}>Open in new tab</TrustedMenuItem>
      <TrustedMenuItem
        disabled={!onPin}
        title={!onPin ? (readOnly ? 'Read-only access' : 'Archived page') : undefined}
        aria-label={
          !onPin
            ? `${pinned ? 'Unpin' : 'Pin'} — ${readOnly ? 'Read-only access' : 'Archived page'}`
            : undefined
        }
        onSelect={onPin}
      >
        {pinned ? 'Unpin' : 'Pin'}
      </TrustedMenuItem>
      <DropdownMenuSeparator />
      <TrustedMenuItem
        disabled={readOnly}
        title={reason}
        aria-label={reason ? `Manage… — ${reason}` : undefined}
        onSelect={onManage}
      >
        Manage…
      </TrustedMenuItem>
      <TrustedMenuItem
        disabled={readOnly}
        title={reason}
        aria-label={reason ? `Projects… — ${reason}` : undefined}
        onSelect={onProjects}
      >
        Projects…
      </TrustedMenuItem>
      <TrustedMenuItem
        disabled={readOnly}
        title={reason}
        aria-label={reason ? `${archived ? 'Restore' : 'Archive'} — ${reason}` : undefined}
        onSelect={onArchive}
      >
        {archived ? 'Restore' : 'Archive'}
      </TrustedMenuItem>
      <DropdownMenuSeparator />
      <TrustedMenuItem
        variant="destructive"
        disabled={readOnly}
        title={reason}
        aria-label={reason ? `Delete — ${reason}` : undefined}
        onSelect={onDelete}
      >
        Delete
      </TrustedMenuItem>
      {(onCopyId || footer) && <DropdownMenuSeparator />}
      {onCopyId && <TrustedMenuItem onSelect={onCopyId}>Copy page ID</TrustedMenuItem>}
      {footer && <DropdownMenuLabel>{footer}</DropdownMenuLabel>}
    </>
  );
}

/** The page's project chips open the same membership picker as its Projects menu item. */
export function PageListProjectPicker({
  label,
  projects,
  selectedOrder,
  open,
  onOpenChange,
  onProject,
  onNewProject,
  newDisabledReason,
}: {
  label: string;
  projects: readonly PageListProjectChoice[];
  selectedOrder?: readonly string[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onProject(name: string, checked: boolean): void;
  onNewProject(): void;
  newDisabledReason?: string;
}) {
  const checked = projects.filter((project) => project.checked === true);
  const selected = selectedOrder
    ? [...checked].sort((a, b) => selectedOrder.indexOf(a.name) - selectedOrder.indexOf(b.name))
    : checked;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="tmt-page-list-project-picker"
          data-empty={selected.length === 0 || undefined}
          tabIndex={selected.length === 0 ? -1 : undefined}
          aria-label={label}
          title={selected.map((project) => project.name).join(', ') || undefined}
        >
          {selected.slice(0, 1).map((project) => (
            <PageListProjectChip key={project.name} name={project.name} />
          ))}
          {selected.length > 1 && (
            <span className="tmt-page-list-project-overflow">+{selected.length - 1}</span>
          )}
          {selected.length === 0 && <Plus aria-hidden="true" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {projects.map((project) => (
          <TrustedMenuCheckboxItem
            key={project.name}
            checked={project.checked}
            disabled={!!project.disabledReason}
            title={project.disabledReason}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => onProject(project.name, checked === true)}
          >
            {project.name}
          </TrustedMenuCheckboxItem>
        ))}
        {projects.length > 0 && <DropdownMenuSeparator />}
        <TrustedMenuItem
          disabled={!!newDisabledReason}
          title={newDisabledReason}
          onSelect={onNewProject}
        >
          New project…
        </TrustedMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The page-list loading state shown while the host opens its data source. */
export function PageListLoading() {
  return (
    <div className="tmt-page-list-loading" aria-label="Loading pages">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="tmt-page-list-skeleton" />
      ))}
    </div>
  );
}

/** The host owns retry and chooses when a connection failure is eligible for this view. */
export function PageListError({ onRetry }: { onRetry(): void }) {
  return (
    <Alert>
      <AlertTitle>Could not load pages</AlertTitle>
      <AlertDescription>
        The connection to this machine dropped. Pages come back when it reconnects.
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="tmt-page-list-retry"
          onClick={(event) => {
            if (event.nativeEvent.isTrusted) onRetry();
          }}
        >
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
