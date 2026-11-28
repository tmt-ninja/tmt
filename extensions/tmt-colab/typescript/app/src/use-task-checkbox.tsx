import { BrowserAction, BrowserIconAction } from '@tmt/browser-ui/react';
import { X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { SelectionRect } from './renderer.js';
import { SaveRefused, saveMessage } from './save.js';
import { text } from './strings.js';
import type { PageBinding, PageView } from './transport.js';

import './task-checkbox.css';

const excluded =
  'head,script,style,template,noscript,tmt-thread-ref,[hidden],[data-colab-highlight],[data-colab-image]';
const forms = 'form,fieldset,tmt-question,tmt-questions';
const t = text.taskCheckbox;

function task(source: string, ordinal: number) {
  // Parsing in a template keeps author code and custom elements outside the trusted dialog.
  const template = document.createElement('template');
  template.innerHTML = source;
  const input = [...template.content.querySelectorAll('input')].filter(
    (node) => node.namespaceURI === 'http://www.w3.org/1999/xhtml',
  )[ordinal];
  if (
    !input ||
    input.type !== 'checkbox' ||
    input.disabled ||
    input.hasAttribute('form') ||
    input.closest(`${forms},${excluded}`)
  )
    return;
  const heading = [...template.content.querySelectorAll('h2,h3')].findLast(
    (node) =>
      !node.closest(`${excluded},tmt-question`) &&
      !!(node.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  if (!heading) return;
  const bounded = (value: string | null | undefined) =>
    value
      ?.replace(/[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 120);
  // The template's inert document does not expose associations through input.labels.
  const labels = [...template.content.querySelectorAll('label')].filter((label) =>
    label.hasAttribute('for')
      ? !!label.htmlFor && template.content.getElementById(label.htmlFor) === input
      : label.querySelector(
          'button,input:not([type="hidden" i]),meter,output,progress,select,textarea',
        ) === input,
  );
  const label =
    bounded(input.getAttribute('aria-label')) ||
    bounded(labels.map((label) => label.textContent).join(' '));
  return {
    label,
    location: t.location(ordinal),
    section: bounded(heading.textContent),
    checked: !input.defaultChecked,
  };
}

interface Proposal {
  target: NonNullable<ReturnType<typeof task>>;
  source: string;
  ordinal: number;
  anchor: () => SelectionRect;
  revision?: string;
  error?: string;
}

/** The renderer can only nominate an ordinal. The owner confirms a source-derived change in
 * trusted chrome; neither frame messages nor synthetic button activations can publish it. */
export function useTaskCheckbox(view: PageView, binding?: PageBinding) {
  const [proposal, setProposal] = useState<Proposal>();
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const active = useRef<Proposal | undefined>(undefined);
  const writing = useRef(false);
  const anchor = proposal?.anchor;
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node || !anchor) return;
    const position = () => {
      const gap = 8;
      const { x, y, width, height } = anchor();
      const { offsetWidth, offsetHeight } = node;
      const right = x + width + gap;
      const fitsBeside = right + offsetWidth <= window.innerWidth - gap;
      const left = fitsBeside ? right : x;
      const below = y + height + gap;
      const top = fitsBeside
        ? y
        : below + offsetHeight <= window.innerHeight - gap
          ? below
          : y - offsetHeight - gap;
      node.style.left = `${Math.max(gap, Math.min(left, window.innerWidth - offsetWidth - gap))}px`;
      node.style.top = `${Math.max(gap, Math.min(top, window.innerHeight - offsetHeight - gap))}px`;
    };
    const outside = (event: PointerEvent) => {
      if (event.isTrusted && !node.contains(event.target as Node) && !writing.current) {
        active.current = undefined;
        setProposal(undefined);
      }
    };
    node.showPopover();
    // A nomination can be forged. Move focus to the prompt so the reader's next
    // Enter cannot be redirected into a save. Tab deliberately enters the action.
    node.focus({ preventScroll: true });
    position();
    const size = new ResizeObserver(position);
    size.observe(node);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.addEventListener('pointerdown', outside, true);
    return () => {
      size.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('pointerdown', outside, true);
      if (node.matches(':popover-open')) node.hidePopover();
    };
  }, [anchor]);
  const enabled =
    view.pageType !== 'blocks' &&
    !view.archived &&
    binding?.canMetadata?.() === true &&
    !!binding.metadata &&
    !!binding.metadataRevision;

  function nominate(source: string, ordinal: number, anchor: Proposal['anchor']) {
    if (!enabled || source !== view.source || active.current) return;
    const target = task(source, ordinal);
    if (!target) return;
    const next = { target, source, ordinal, anchor };
    active.current = next;
    setProposal(next);
    void binding!.metadataRevision!(view, 'conversion').then(
      (revision) => finish(next, { revision }),
      (failure: unknown) => finish(next, { error: failureMessage(failure) }),
    );
  }
  function finish(current: Proposal, patch: Partial<Proposal>) {
    if (active.current !== current) return;
    const next = { ...current, ...patch };
    active.current = next;
    setProposal(next);
  }
  function dismiss() {
    if (writing.current) return;
    active.current = undefined;
    setProposal(undefined);
  }
  async function confirm() {
    const current = active.current;
    if (!enabled || !current?.revision || writing.current || current.error) return;
    if (current.source !== view.source) {
      finish(current, { error: t.stale });
      return;
    }
    writing.current = true;
    setBusy(true);
    try {
      await binding!.metadata!(
        'html.checkbox',
        {
          input: current.ordinal,
          checked: current.target.checked,
        },
        current.revision,
      );
      active.current = undefined;
      setProposal(undefined);
    } catch (failure) {
      finish(current, { error: failureMessage(failure) });
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  const action = proposal?.target.checked ? t.check : t.uncheck;
  const dialog = proposal && (
    <div
      className="task-checkbox-confirm"
      ref={panel}
      popover="manual"
      tabIndex={-1}
      role="dialog"
      aria-label={action.title}
      aria-describedby={labelId}
      onKeyDown={(event) => {
        if (event.isTrusted && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }
      }}
    >
      <div className="task-checkbox-label" id={labelId}>
        {proposal.target.label || proposal.target.location}
        {proposal.target.section && <> · {proposal.target.section}</>}
      </div>
      {proposal.error ? (
        <p className="task-checkbox-error" role="alert">
          {proposal.error}
        </p>
      ) : (
        <BrowserAction
          type="button"
          variant="primary"
          presentation="compact"
          label={action.save}
          disabled={!enabled || !proposal.revision}
          busy={busy}
          onActivate={(event) => {
            if (event.isTrusted) void confirm();
          }}
        />
      )}
      <BrowserIconAction
        type="button"
        variant="text"
        label={t.close}
        icon={<X aria-hidden="true" />}
        disabled={busy}
        onActivate={dismiss}
      />
    </div>
  );
  return { nominate: enabled ? nominate : undefined, dialog };
}

function failureMessage(error: unknown): string {
  return error instanceof SaveRefused && error.code === 'COLAB_STALE_BASE'
    ? t.stale
    : saveMessage(error);
}
