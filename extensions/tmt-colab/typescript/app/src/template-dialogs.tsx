import { useEffect, useId, useRef, useState } from 'react';
import { BrowserAction, BrowserDialog, BrowserField } from '@tmt/browser-ui/react';
import type { ManagementPort } from './management.js';
import { SaveRefused } from './save.js';
import { BUILT_IN_TEMPLATES, validTemplateName } from './template-marks.js';
import type { PageBinding, PageView } from './transport.js';
import { text } from './strings.js';
import './new-page-dialog.css';

const t = text.templates;
export type TemplateDialogKind = 'save' | 'settings' | 'remove';

/** The rules of a template page: its HTML comments, as `template show` numbers them. */
export function ruleComments(source: string): string[] {
  return [...source.matchAll(/<!--([\s\S]*?)-->/g)]
    .map((match) => match[1]!.split(/\s+/).filter(Boolean).join(' '))
    .filter(Boolean);
}
/** A name from a title: lowercase letters, digits and single hyphens, at most 40. */
export function nameFromTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'template'
  );
}
/** Why a name cannot be saved as this page's, as far as this browser can tell; the owner decides. */
function nameProblem(name: string, taken: ReadonlySet<string>): string | undefined {
  if ((BUILT_IN_TEMPLATES as readonly string[]).includes(name))
    return 'COLAB_TEMPLATE_NAME_RESERVED';
  if (!validTemplateName(name)) return 'COLAB_TEMPLATE_NAME_INVALID';
  if (taken.has(name)) return 'COLAB_TEMPLATE_NAME_TAKEN';
  return undefined;
}
function suggestion(name: string, taken: ReadonlySet<string>): string | undefined {
  const base = validTemplateName(name) ? name : nameFromTitle(name);
  for (const suffix of ['-2', '-3', '-4', '-ops', '-copy']) {
    const next = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!nameProblem(next, taken)) return next;
  }
  return undefined;
}

/**
 * Save as template (#5077, screen 2), Template settings (the same fields for a template) and
 * Remove template, on the page's owner metadata path (`template.set`, `template.clear`). The
 * owner admits the name; this browser only says early what it can see in the template list.
 */
export function TemplateDialogs({
  kind,
  pageId,
  view,
  binding,
  management,
  onDone,
  onDismiss,
}: {
  kind: TemplateDialogKind | null;
  pageId: string;
  view: PageView;
  binding?: PageBinding;
  management?: ManagementPort;
  onDone(message: string): void;
  onDismiss(): void;
}) {
  return kind === null ? null : (
    <TemplateDialog
      key={kind}
      kind={kind}
      pageId={pageId}
      view={view}
      binding={binding}
      management={management}
      onDone={onDone}
      onDismiss={onDismiss}
    />
  );
}

function TemplateDialog({
  kind,
  pageId,
  view,
  binding,
  management,
  onDone,
  onDismiss,
}: Parameters<typeof TemplateDialogs>[0] & { kind: TemplateDialogKind }) {
  const ids = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLElement>(null);
  const current = view.template;
  const [name, setName] = useState(current?.name ?? nameFromTitle(view.title));
  const [description, setDescription] = useState(current?.description ?? '');
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!management || kind === 'remove') return;
    const abort = new AbortController();
    management.readTemplates(abort.signal).then(
      (listing) => {
        if (abort.signal.aborted) return;
        setTaken(
          new Set(
            listing.templates
              .filter((tpl) => tpl.source === 'space' && tpl.id !== pageId)
              .map((tpl) => tpl.name),
          ),
        );
      },
      () => {
        // The owner still checks the name; without the list nothing is said early.
      },
    );
    return () => abort.abort();
  }, [management, kind, pageId]);
  const problem = kind === 'remove' ? undefined : nameProblem(name, taken);
  const suggested = problem ? suggestion(name, taken) : undefined;
  const rules = ruleComments(view.source).length;

  async function submit() {
    if (busy || !binding?.metadata || !binding.metadataRevision) return;
    if (problem) return nameRef.current?.focus();
    setBusy(true);
    setError(undefined);
    try {
      const revision = await binding.metadataRevision(view);
      if (kind === 'remove') {
        await binding.metadata('template.clear', {}, revision);
        onDone(t.removed(current?.name ?? name));
      } else {
        await binding.metadata('template.set', { name, description: description.trim() }, revision);
        onDone(t.saved(name));
      }
    } catch (failure) {
      const code = failure instanceof SaveRefused ? failure.code : '';
      setError(t.nameErrors[code] ?? t.saveRefused(code));
      setBusy(false);
    }
  }

  if (kind === 'remove')
    return (
      <BrowserDialog
        open
        presentation="confirm"
        title={t.remove}
        onDismiss={() => {
          if (!busy) onDismiss();
        }}
        initialFocus={() => confirmRef.current}
        actions={
          <>
            <BrowserAction
              type="button"
              variant="secondary"
              label={t.cancel}
              disabled={busy}
              onActivate={onDismiss}
            />
            <BrowserAction
              type="button"
              variant="destructive"
              label={t.remove}
              busy={busy}
              onActivate={() => void submit()}
            />
          </>
        }
      >
        <div className="new-page" ref={confirmRef as never} tabIndex={-1}>
          <p className="new-page-note">{text.templates.removeBody(current?.name ?? name)}</p>
          {error && (
            <p className="new-page-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </BrowserDialog>
    );
  return (
    <BrowserDialog
      open
      title={kind === 'save' ? t.saveTitle : t.settingsTitle}
      onDismiss={() => {
        if (!busy) onDismiss();
      }}
      initialFocus={() => nameRef.current}
      actions={
        <>
          <BrowserAction
            type="button"
            variant="secondary"
            label={t.cancel}
            disabled={busy}
            onActivate={onDismiss}
          />
          <BrowserAction
            type="button"
            variant="primary"
            label={kind === 'save' ? t.save : t.saveChanges}
            busy={busy}
            disabled={problem !== undefined}
            onActivate={() => void submit()}
          />
        </>
      }
    >
      <form
        className="new-page"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <BrowserField
          controlId={`${ids}-name`}
          label={t.nameLabel}
          errorId={`${ids}-name-error`}
          invalid={problem !== undefined}
          error={
            problem ? (
              <>
                {t.nameErrors[problem]}
                {suggested && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="new-page-link"
                      onClick={() => {
                        setName(suggested);
                        nameRef.current?.focus();
                      }}
                    >
                      {t.suggest(suggested)}
                    </button>
                  </>
                )}
              </>
            ) : undefined
          }
          renderControl={(props) => (
            <input
              {...props}
              ref={nameRef}
              value={name}
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        />
        <BrowserField
          controlId={`${ids}-description`}
          label={t.descriptionLabel}
          renderControl={(props) => (
            <input
              {...props}
              value={description}
              maxLength={80}
              autoComplete="off"
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        />
        <p className="new-page-note">
          {t.saveHelp} {t.rules(rules)}
        </p>
        {error && (
          <p className="new-page-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </BrowserDialog>
  );
}
