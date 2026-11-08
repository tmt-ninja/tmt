import type { CSSProperties, ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { BrowserCheckbox } from '../checkbox.js';
import { BrowserCommand } from '../command.js';
import { BrowserNotice } from '../notice.js';
import type { BrowserNoticeTone } from '../static.js';
import { BrowserTable } from '../table.js';
import './blocks.css';

const empty = (children: ReactNode) =>
  children === undefined || children === null || children === '';

export interface HeadingBlockProps {
  /** ## or ###. The page title is the GUI header's, never a block, so there is no level 1. */
  level?: 2 | 3;
  placeholder?: string;
  /** An editor holds the text (a contenteditable root, which phrasing elements cannot hold): the
   * part draws a div container with the same metrics, so rest and typing do not shift. */
  editing?: boolean;
  children?: ReactNode;
}

export function HeadingBlock({
  level = 2,
  placeholder = 'Heading',
  editing,
  children,
}: HeadingBlockProps) {
  // Number(): a tmt GUI port passes its attribute text.
  const Tag = editing ? 'div' : Number(level) === 3 ? 'h3' : 'h2';
  return (
    <Tag
      data-slot="heading-block"
      className="tmt-block-heading"
      {...(editing && { role: 'heading', 'aria-level': Number(level) === 3 ? 3 : 2 })}
      data-level={level}
      data-empty={empty(children) ? '' : undefined}
      data-placeholder={empty(children) ? placeholder : undefined}
    >
      {children}
    </Tag>
  );
}

export interface TextBlockProps {
  tone?: 'default' | 'muted';
  /** Shown while the paragraph is empty. */
  placeholder?: string;
  /** An editor holds the text (a contenteditable root, which phrasing elements cannot hold): the
   * part draws a div container with the same metrics, so rest and typing do not shift. */
  editing?: boolean;
  children?: ReactNode;
}

export function TextBlock({
  tone = 'default',
  placeholder = 'Type / for blocks',
  editing,
  children,
}: TextBlockProps) {
  const Tag = editing ? 'div' : 'p';
  return (
    <Tag
      data-slot="text-block"
      className="tmt-block-text"
      data-tone={tone === 'muted' ? 'muted' : undefined}
      data-empty={empty(children) ? '' : undefined}
      data-placeholder={empty(children) ? placeholder : undefined}
    >
      {children}
    </Tag>
  );
}

export interface ListItemBlockProps {
  /** `number` items take their number from the run of same-level items before them. */
  marker?: 'bullet' | 'number';
  number?: number;
  indent?: 0 | 1 | 2;
  children?: ReactNode;
}

/** One list item is one block, so each item moves and is mentioned on its own. */
export function ListItemBlock({
  marker = 'bullet',
  number = 1,
  indent = 0,
  children,
}: ListItemBlockProps) {
  return (
    <div
      data-slot="list-item"
      className="tmt-block-list"
      data-marker={marker}
      style={indent ? ({ '--tmt-block-indent': indent } as CSSProperties) : undefined}
    >
      <span className="tmt-block-list-marker" aria-hidden="true">
        {marker === 'number' ? `${number}.` : Number(indent) === 1 ? '◦' : '•'}
      </span>
      <div>{children}</div>
    </div>
  );
}

export interface TodoBlockProps {
  checked?: boolean;
  onCheckedChange?(checked: boolean): void;
  /** Names the checkbox; defaults to the text when it is a string. */
  label?: string;
  assignee?: ReactNode;
  due?: ReactNode;
  /** Marks the due text in the blocked colour; the host writes "Overdue" into it, so colour is never alone. */
  overdue?: boolean;
  indent?: 0 | 1 | 2;
  /** An editor holds the text (a contenteditable root, which phrasing elements cannot hold): the
   * part draws a div container with the same metrics, so rest and typing do not shift. */
  editing?: boolean;
  children?: ReactNode;
}

export function TodoBlock({
  checked = false,
  onCheckedChange,
  label,
  assignee,
  due,
  overdue,
  indent = 0,
  editing,
  children,
}: TodoBlockProps) {
  const Text = editing ? 'div' : 'span';
  return (
    <div
      data-slot="todo"
      className="tmt-block-todo"
      data-checked={checked ? '' : undefined}
      data-overdue={overdue ? '' : undefined}
      style={indent ? ({ '--tmt-block-indent': indent } as CSSProperties) : undefined}
    >
      <BrowserCheckbox
        checked={checked}
        readOnly={!onCheckedChange}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
        aria-label={label ?? (typeof children === 'string' ? children : undefined)}
      />
      <Text className="tmt-block-todo-text">{children}</Text>
      {(assignee !== undefined || due !== undefined) && (
        <span className="tmt-block-todo-meta">
          {assignee}
          {due !== undefined && <span className="tmt-block-todo-due">{due}</span>}
        </span>
      )}
    </div>
  );
}

export interface TableBlockColumn {
  /** The heading: text, or an editor's name field while the column is renamed. */
  name: ReactNode;
  /** A stable key (the column's ID); the name otherwise. */
  key?: string;
  /** Leave the column out while the block is narrower than 480px; its cells stay in the DOM. */
  hideNarrow?: boolean;
  nowrap?: boolean;
  /** A control after the heading: an editor's column menu. */
  action?: ReactNode;
}

export interface TableBlockProps {
  label: string;
  /** Roomy (the default) is the document table; compact is tighter rows for long lists. */
  density?: 'roomy' | 'compact';
  columns?: readonly TableBlockColumn[];
  rows?: readonly (readonly ReactNode[])[];
  /** Stable row keys (the rows' IDs); indexes otherwise. */
  rowKeys?: readonly string[];
  /** A control at the end of each row (an editor's row menu), under a heading named
   * `rowActionsLabel`. */
  rowActions?: readonly ReactNode[];
  rowActionsLabel?: string;
  /** A table with no rows shows this as its one row (the editor's "Add a row"). */
  empty?: ReactNode;
}

/** A table block: the shared table, collapsing on its own width (a container query), not the viewport's. */
export function TableBlock({
  label,
  density = 'roomy',
  columns = [],
  rows = [],
  rowKeys,
  rowActions,
  rowActionsLabel,
  empty,
}: TableBlockProps) {
  const indexes = (pick: (column: TableBlockColumn) => boolean | undefined) =>
    columns.flatMap((column, index) => (pick(column) ? [index] : []));
  return (
    <div data-slot="table-block" className="tmt-block-table" data-density={density}>
      <BrowserTable
        label={label}
        columns={columns.map((column) => column.name)}
        columnKeys={columns.map((column, index) => column.key ?? String(index))}
        columnActions={
          columns.some((column) => column.action !== undefined)
            ? columns.map((column) => column.action)
            : undefined
        }
        rows={rows}
        rowKeys={rowKeys}
        rowActions={rowActions}
        rowActionsLabel={rowActionsLabel}
        hideNarrow={indexes((column) => column.hideNarrow)}
        nowrap={indexes((column) => column.nowrap)}
        empty={empty}
      />
    </div>
  );
}

export interface CardBlockProps {
  /** `section` groups blocks under a label with no frame. */
  variant?: 'card' | 'section';
  title?: ReactNode;
  meta?: ReactNode;
  /** Its child blocks: one level only, never another card. */
  children?: ReactNode;
}

/** The only block that nests, and the only one that draws a frame. */
export function CardBlock({ variant = 'card', title, meta, children }: CardBlockProps) {
  return (
    <section data-slot="card-block" className="tmt-block-card" data-variant={variant}>
      {(title !== undefined || meta !== undefined) && (
        <div className="tmt-block-card-head">
          {title !== undefined && <h3 className="tmt-block-card-title">{title}</h3>}
          {meta !== undefined && <span className="tmt-block-card-meta">{meta}</span>}
        </div>
      )}
      <div className="tmt-block-card-body">{children}</div>
    </section>
  );
}

export type CalloutTone = Exclude<BrowserNoticeTone, 'muted'>;
/** Each tone's mark and word, so a tone never relies on colour alone. */
export const calloutLabels: Record<CalloutTone, [mark: string, word: string]> = {
  working: ['●', 'Working'],
  waiting: ['◆', 'Waiting on you'],
  review: ['◇', 'In review'],
  blocked: ['✗', 'Blocked'],
};

export interface CalloutProps {
  tone?: CalloutTone;
  /** Replaces the tone's word, such as "Needs you". */
  label?: string;
  heading?: string;
  children?: ReactNode;
}

/** A passage the reader must notice: the shared tinted notice, as a note, without a box of its own. */
export function Callout({ tone = 'working', label, heading, children }: CalloutProps) {
  const [mark, word] = calloutLabels[tone];
  return (
    <div data-slot="callout" className="tmt-block-callout">
      <BrowserNotice
        tone={tone}
        variant="tinted"
        announcement="note"
        mark={mark}
        stateLabel={label ?? word}
        title={heading}
        headingLevel="h3"
        body={children}
      />
    </div>
  );
}

export interface CodeBlockProps {
  /** The source text, shown literally. */
  text: string;
  language?: string;
  filename?: string;
  /** False keeps long lines and scrolls inside the block. */
  wrap?: boolean;
  /** `command` is one copyable line: the shared command. */
  variant?: 'block' | 'command';
  /** The host copies; the block only asks. */
  onCopy?(): void;
  copied?: boolean;
  copyLabel?: string;
  copiedLabel?: string;
}

export function CodeBlock({
  text,
  language = 'text',
  filename,
  wrap = true,
  variant = 'block',
  onCopy,
  copied = false,
  copyLabel = 'Copy code',
  copiedLabel = 'Copied',
}: CodeBlockProps) {
  if (variant === 'command') return <BrowserCommand text={text} />;
  return (
    <div data-slot="code-block" className="tmt-block-code">
      <div className="tmt-block-code-head">
        <span className="tmt-block-code-file">{filename ?? language}</span>
        {filename !== undefined && <span>{language}</span>}
        <button
          type="button"
          className="tmt-block-code-copy"
          aria-label={copied ? copiedLabel : copyLabel}
          onClick={onCopy}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          <span aria-live="polite">{copied ? copiedLabel : ''}</span>
        </button>
      </div>
      <pre className="tmt-block-code-body" data-wrap={wrap ? undefined : 'false'}>
        <code>{text}</code>
      </pre>
    </div>
  );
}
