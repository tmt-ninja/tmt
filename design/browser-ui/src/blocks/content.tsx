import type { CSSProperties, ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Checkbox } from '../ui/index.js';
import './blocks.css';

// The entry reaches only ./ui. The static table, tinted notice and command exist only in the root
// graph, so it draws them by their stable class names, as the tmt GUI ports do (#6032 review).
const c = {
  table: 'tmt-ui-table',
  notice: 'tmt-ui-notice',
  noticeEyebrow: 'tmt-ui-notice-eyebrow',
  noticeHeading: 'tmt-ui-notice-heading',
  noticeBody: 'tmt-ui-notice-body',
  command: 'tmt-ui-command',
  commandText: 'tmt-ui-command-text',
} as const;

const empty = (children: ReactNode) =>
  children === undefined || children === null || children === '';

export interface HeadingBlockProps {
  /** ## or ###. The page title is the GUI header's, never a block, so there is no level 1. */
  level?: 2 | 3;
  placeholder?: string;
  children?: ReactNode;
}

export function HeadingBlock({ level = 2, placeholder = 'Heading', children }: HeadingBlockProps) {
  // Number(): a tmt GUI port passes its attribute text.
  const Tag = Number(level) === 3 ? 'h3' : 'h2';
  return (
    <Tag
      data-slot="heading-block"
      className="tmt-block-heading"
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
  children?: ReactNode;
}

export function TextBlock({
  tone = 'default',
  placeholder = 'Type / for blocks',
  children,
}: TextBlockProps) {
  return (
    <p
      data-slot="text-block"
      className="tmt-block-text"
      data-tone={tone === 'muted' ? 'muted' : undefined}
      data-empty={empty(children) ? '' : undefined}
      data-placeholder={empty(children) ? placeholder : undefined}
    >
      {children}
    </p>
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
      role="listitem"
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
  children,
}: TodoBlockProps) {
  return (
    <div
      data-slot="todo"
      className="tmt-block-todo"
      data-checked={checked ? '' : undefined}
      data-overdue={overdue ? '' : undefined}
      style={indent ? ({ '--tmt-block-indent': indent } as CSSProperties) : undefined}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(next) => onCheckedChange?.(next === true)}
        aria-label={label ?? (typeof children === 'string' ? children : undefined)}
      />
      <span className="tmt-block-todo-text">{children}</span>
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
  name: string;
  /** Leave the column out while the block is narrower than 480px; its cells stay in the DOM. */
  hideNarrow?: boolean;
  nowrap?: boolean;
}

export interface TableBlockProps {
  label: string;
  columns?: readonly TableBlockColumn[];
  rows?: readonly (readonly ReactNode[])[];
}

/** A table block: the shared table, collapsing on its own width (a container query), not the viewport's. */
export function TableBlock({ label, columns = [], rows = [] }: TableBlockProps) {
  const cell = (index: number) => ({
    'data-hide-narrow': columns[index]?.hideNarrow ? '' : undefined,
    'data-nowrap': columns[index]?.nowrap ? '' : undefined,
  });
  return (
    <div data-slot="table-block" className="tmt-block-table">
      <table className={c.table} aria-label={label}>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={column.name} scope="col" {...cell(index)}>
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, at) => (
            <tr key={at}>
              {row.map((value, index) => (
                <td key={index} {...cell(index)}>
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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

export type CalloutTone = 'working' | 'waiting' | 'review' | 'blocked';
/** Each tone's mark and word, so a tone never relies on colour alone. */
export const calloutEyebrows: Record<CalloutTone, string> = {
  working: '● Working',
  waiting: '◆ Waiting on you',
  review: '◇ In review',
  blocked: '✗ Blocked',
};

export interface CalloutProps {
  tone?: CalloutTone;
  eyebrow?: string;
  heading?: ReactNode;
  children?: ReactNode;
}

/** A passage the reader must notice: the shared tinted notice, without a box of its own. */
export function Callout({ tone = 'working', eyebrow, heading, children }: CalloutProps) {
  return (
    <div
      data-slot="callout"
      role="note"
      className={`${c.notice} tmt-block-callout`}
      data-tone={tone}
      data-tinted=""
    >
      <div className={c.noticeEyebrow}>{eyebrow ?? calloutEyebrows[tone]}</div>
      {heading !== undefined && <h3 className={c.noticeHeading}>{heading}</h3>}
      <div className={c.noticeBody}>{children}</div>
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
  if (variant === 'command')
    return (
      <div className={c.command}>
        <pre className={c.commandText}>
          <code>{text}</code>
        </pre>
      </div>
    );
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
