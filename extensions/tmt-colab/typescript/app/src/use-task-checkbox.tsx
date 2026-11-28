import { BrowserAction, BrowserDialog } from '@tmt/browser-ui/react';
import { useRef, useState } from 'react';
import { SaveRefused, saveMessage } from './save.js';
import { text } from './strings.js';
import type { PageBinding, PageView } from './transport.js';

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
  revision?: string;
  error?: string;
}

/** The renderer can only nominate an ordinal. The owner confirms a source-derived change in
 * trusted chrome; neither frame messages nor synthetic button activations can publish it. */
export function useTaskCheckbox(view: PageView, binding?: PageBinding) {
  const [proposal, setProposal] = useState<Proposal>();
  const [busy, setBusy] = useState(false);
  const active = useRef<Proposal | undefined>(undefined);
  const writing = useRef(false);
  const enabled =
    view.pageType !== 'blocks' &&
    !view.archived &&
    binding?.canMetadata?.() === true &&
    !!binding.metadata &&
    !!binding.metadataRevision;

  function nominate(source: string, ordinal: number) {
    if (!enabled || source !== view.source || active.current) return;
    const target = task(source, ordinal);
    if (!target) return;
    const next = { target, source, ordinal };
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
    <BrowserDialog
      open
      title={action.title}
      onDismiss={dismiss}
      actions={
        <>
          <BrowserAction
            type="button"
            variant="secondary"
            label={proposal.error ? 'Close' : 'Cancel'}
            disabled={busy}
            onActivate={dismiss}
          />
          {!proposal.error && (
            <BrowserAction
              type="button"
              variant="primary"
              label={action.save}
              disabled={!enabled || !proposal.revision}
              busy={busy}
              onActivate={(event) => {
                if (event.isTrusted) void confirm();
              }}
            />
          )}
        </>
      }
    >
      <p>
        {proposal.target.label && <>“{proposal.target.label}” · </>}
        {proposal.target.location}
        {proposal.target.section && <> · {proposal.target.section}</>}
      </p>
      {proposal.error ? <p role="alert">{proposal.error}</p> : <p>{t.explanation}</p>}
    </BrowserDialog>
  );
  return { nominate: enabled ? nominate : undefined, dialog };
}

function failureMessage(error: unknown): string {
  return error instanceof SaveRefused && error.code === 'COLAB_STALE_BASE'
    ? t.stale
    : saveMessage(error);
}
