/** Provider forms in web Ops (#6445): a member waiting on a Claude Code, Codex or agy form shows
 * the form in its DM, and its row says so. Only the person answers, and only a form the board saw
 * whole and Core lets the client answer. An answer is stored before it is sent and is recovered by
 * its own operation ID only; nothing here retries delivery or allocates a second ID for it. */
import { browserUiClasses as c } from '@tmt/browser-ui/static';
import type {
  FormAnswer,
  FormAnswerState,
  FormQuestion,
  ProviderForm,
  RemoteForms,
} from './forms.js';
import { el } from './ops-parts.js';

/** One answer this browser started: kept until Core's outcome for its operation ID is settled. */
interface Sent {
  operationId: string;
  formId: string;
  identityId: string;
  /** What the form asked, so a form that is gone can still be named. */
  asked: string;
  answer: FormAnswer;
  state?: 'accepted' | 'refused' | 'uncertain';
  reason?: string;
  message?: string;
}

const KEY = 'tmt-ops-form-answer:';
const KIND: Record<ProviderForm['kind'], string> = {
  question: 'Question',
  permission: 'Permission',
  planApproval: 'Plan approval',
};

function stored(): Map<string, Sent> {
  const found = new Map<string, Sent>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(KEY)) continue;
      const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Sent | null;
      if (value?.operationId && value.formId === key.slice(KEY.length))
        found.set(value.formId, value);
    }
  } catch {
    // Unreadable storage holds nothing this page can recover.
  }
  return found;
}
/** False when the answer could not be kept; it is then not sent. */
function keep(sent: Sent): boolean {
  try {
    localStorage.setItem(KEY + sent.formId, JSON.stringify(sent));
    return localStorage.getItem(KEY + sent.formId) === JSON.stringify(sent);
  } catch {
    return false;
  }
}
function drop(formId: string): void {
  try {
    localStorage.removeItem(KEY + formId);
  } catch {
    // A leftover settled entry is harmless; it is dropped again on the next settle.
  }
}

/** A plan's first line of substance: headings are skipped, list marks dropped. */
function planLine(plan: string): string | undefined {
  const lines = plan
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const body = lines.find((line) => !line.startsWith('#')) ?? lines[0];
  return body?.replace(/^(#+|>|[*+-]|\d+[.)])\s*/, '') || undefined;
}

/** What a form asks, in one line: its first question, its tool, or its plan's first line. */
const asked = (form: ProviderForm): string =>
  form.questions?.[0]?.text ??
  form.tool?.name ??
  (form.plan === undefined ? undefined : planLine(form.plan)) ??
  KIND[form.kind];

function ago(ms: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (minutes < 1) return 'opened just now';
  if (minutes < 60) return `opened ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `opened ${hours} h ago` : `opened ${Math.round(hours / 24)} d ago`;
}

export interface OpsForms {
  /** Reads Core's cursor and lists forms again only when it moved. */
  refresh(): Promise<boolean>;
  /** Forms waiting on this member, plus answers whose arrival is still unknown. */
  waiting(identityId: string): number;
  unavailable(): boolean;
  /** Changes whenever what the views draw changes. */
  fingerprint(): string;
  /** The DM's forms: a card per form, or the unavailable line; empty when nothing waits. */
  view(identityId: string, memberName: string): HTMLElement;
}

export function opsForms(
  connect: () => Promise<RemoteForms>,
  changed: () => void,
  newId: () => string = () => crypto.randomUUID(),
): OpsForms {
  let api: Promise<RemoteForms> | undefined;
  let status: 'loading' | 'ready' | 'unavailable' = 'loading';
  let cursor: number | undefined;
  let list: ProviderForm[] = [];
  const sent = stored();
  /** What is in flight for a form: its first send, or a check of the same ID. */
  const busy = new Map<string, 'send' | 'check'>();
  /** Stored answers from an earlier page are checked once by their own ID, then on request. */
  const resumed = new Set<string>();
  const cards = new Map<string, { node: HTMLElement; seen: string }>();
  /** Forms the person opened; the oldest form is always open, so several never bury the talk. */
  const opened = new Set<string>();
  const views = new Map<string, HTMLElement>();
  let version = 0;
  const bump = () => {
    version++;
    changed();
  };
  const client = () =>
    (api ??= connect().catch((error: unknown) => {
      api = undefined;
      throw error;
    }));

  function settle(entry: Sent, state: FormAnswerState): void {
    if (state.state === 'accepted') entry.state = 'accepted';
    else {
      entry.state = state.state;
      entry.reason = state.reason;
      entry.message = state.message;
    }
    if (entry.state === 'uncertain') keep(entry);
    else drop(entry.formId);
  }

  async function check(entry: Sent): Promise<void> {
    if (busy.has(entry.formId)) return;
    busy.set(entry.formId, 'check');
    bump();
    try {
      settle(entry, await (await client()).operation(entry.operationId));
    } catch {
      // Still unknown: the same ID is asked again only when the person chooses to.
      entry.state = 'uncertain';
    } finally {
      busy.delete(entry.formId);
      bump();
    }
  }

  async function send(form: ProviderForm, answer: FormAnswer): Promise<void> {
    if (busy.has(form.formId)) return;
    const previous = sent.get(form.formId);
    if (
      previous &&
      (previous.state !== 'refused' || previous.reason === 'FORM_DELIVERY_UNSUPPORTED')
    )
      return;
    const entry: Sent = {
      operationId: newId(),
      formId: form.formId,
      identityId: form.identityId,
      asked: asked(form),
      answer,
      state: 'uncertain',
    };
    if (!keep(entry)) {
      sent.set(form.formId, {
        ...entry,
        state: 'refused',
        reason: 'LOCAL_STORAGE',
        message: 'This browser could not keep the answer, so it was not sent.',
      });
      bump();
      return;
    }
    sent.set(form.formId, entry);
    busy.set(form.formId, 'send');
    bump();
    try {
      settle(
        entry,
        await (
          await client()
        ).answer({ operationId: entry.operationId, formId: form.formId, answer }),
      );
    } catch {
      // Lost on the way: only `operation(sameId)` may say what happened.
      entry.state = 'uncertain';
    } finally {
      busy.delete(form.formId);
      bump();
    }
  }

  function note(text: string, action?: HTMLElement): HTMLElement {
    const line = el('p', 'ops-form-note', text);
    if (action) line.append(' ', action);
    return line;
  }

  function outcome(entry: Sent, memberName: string): HTMLElement | undefined {
    if (busy.has(entry.formId))
      return note(busy.get(entry.formId) === 'check' ? 'Checking…' : 'Sending…');
    if (entry.state === 'accepted') return note('Sent.');
    if (entry.state === 'uncertain') {
      const again = el('button', c.action, 'Check again');
      again.type = 'button';
      again.dataset.variant = 'text';
      again.addEventListener('click', () => {
        resumed.add(entry.formId);
        void check(entry);
      });
      return note('Not sure it arrived.', again);
    }
    if (entry.reason === 'FORM_DELIVERY_UNSUPPORTED')
      return note(
        `This form can't be answered from the browser yet. Answer it in the terminal where ${memberName} runs.`,
      );
    if (entry.state === 'refused')
      return note(`Not sent: ${entry.message ?? entry.reason ?? 'refused'}.`);
    return undefined;
  }

  function question(
    form: ProviderForm,
    item: FormQuestion,
    index: number,
    open: boolean,
  ): HTMLElement {
    // A group named by its text, so the header stays above it (a legend would be drawn first).
    const part = el('div', 'ops-form-question');
    const text = el('p', `${c.cardTitle} ops-form-text`, item.text);
    text.id = `ops-form-${form.formId}-${index}-text`;
    if (open) {
      part.setAttribute('role', 'group');
      part.setAttribute('aria-labelledby', text.id);
    }
    if (item.header) part.append(el('p', 'ops-form-header', item.header));
    part.append(text);
    const options = el(open ? 'div' : 'ul', 'ops-form-options');
    item.options.forEach((option, at) => {
      const words = el('span', 'ops-form-option-words');
      words.append(el('strong', undefined, option.label));
      if (option.description)
        words.append(el('span', 'ops-form-option-description', option.description));
      if (!open) {
        const row = el('li', 'ops-form-option');
        row.append(words);
        options.append(row);
        return;
      }
      const row = el('label', `${c.checkboxLabel} ops-form-option`);
      const input = el('input', item.choice === 'single' ? c.radio : c.checkbox);
      input.type = item.choice === 'single' ? 'radio' : 'checkbox';
      input.name = `ops-form-${form.formId}-${index}`;
      input.value = String(at);
      row.append(input, words);
      options.append(row);
    });
    part.append(options);
    if (open && item.freeText) {
      const row = el('label', `${c.field} ops-form-other`);
      row.append(el('span', c.fieldLabel, 'Other'));
      const input = el('input', c.fieldControl);
      input.type = 'text';
      input.name = `ops-form-${form.formId}-${index}-other`;
      row.append(input);
      part.append(row);
    }
    return part;
  }

  /** A form folded to one line: its kind, what it asks and when; a click opens it. */
  function folded(form: ProviderForm): HTMLElement {
    const seen = JSON.stringify(['folded', form, ago(form.openedMs)]);
    const cached = cards.get(form.formId);
    if (cached?.seen === seen) return cached.node;
    const node = el('section', `${c.card} ops-form`);
    node.dataset.formId = form.formId;
    node.dataset.kind = form.kind;
    node.dataset.folded = '';
    node.setAttribute('aria-label', `${KIND[form.kind]} form`);
    const toggle = el('button', 'ops-form-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    const kind = el('span', c.chip);
    kind.append(el('span', c.chipLabel, KIND[form.kind]));
    toggle.append(
      kind,
      el('span', 'ops-form-toggle-text', asked(form)),
      el('span', 'ops-form-time', ago(form.openedMs)),
    );
    toggle.addEventListener('click', () => {
      opened.add(form.formId);
      bump();
      cards.get(form.formId)?.node.focus();
    });
    node.append(toggle);
    cards.set(form.formId, { node, seen });
    return node;
  }

  function card(form: ProviderForm, memberName: string): HTMLElement {
    const entry = sent.get(form.formId);
    const inFlight = busy.has(form.formId);
    // Controls only for a form seen whole that the client may answer; never for permission.
    const open = form.answerable && !form.truncated && form.kind !== 'permission';
    const locked =
      inFlight ||
      (!!entry && (entry.state !== 'refused' || entry.reason === 'FORM_DELIVERY_UNSUPPORTED'));
    const seen = JSON.stringify([form, entry, inFlight, memberName, ago(form.openedMs)]);
    const cached = cards.get(form.formId);
    if (cached?.seen === seen) return cached.node;
    const node = el('section', `${c.card} ops-form`);
    node.dataset.formId = form.formId;
    node.dataset.kind = form.kind;
    node.tabIndex = -1;
    node.setAttribute('aria-label', `${KIND[form.kind]} form`);
    const head = el('div', `${c.cardHead} ops-form-head`);
    const kind = el('span', c.chip);
    kind.append(el('span', c.chipLabel, KIND[form.kind]));
    head.append(kind, el('span', 'ops-form-time', ago(form.openedMs)));
    node.append(head);
    const body = el(open ? 'form' : 'div', 'ops-form-body');
    if (form.kind === 'permission' && form.tool) {
      body.append(el('p', `${c.cardTitle} ops-form-text`, form.tool.name));
      body.append(el('p', 'ops-form-summary', form.tool.summary));
    }
    if (form.kind === 'planApproval') {
      body.append(el('p', `${c.cardTitle} ops-form-text`, 'Approve this plan?'));
      if (form.plan !== undefined) body.append(el('pre', 'ops-form-plan', form.plan));
    }
    form.questions?.forEach((item, index) => body.append(question(form, item, index, open)));
    node.append(body);
    const lines: HTMLElement[] = [];
    if (form.truncated)
      lines.push(
        note(
          `Only part of this form is shown here. Answer it in the terminal where ${memberName} runs.`,
        ),
      );
    else if (!open) lines.push(note(`Answer this in the terminal where ${memberName} runs.`));
    const said = entry && outcome(entry, memberName);
    if (said) lines.push(said);
    if (open && body instanceof HTMLFormElement) {
      const actions = el('div', 'ops-form-actions');
      if (form.kind === 'planApproval') {
        for (const [label, decision] of [
          ['Approve', 'allow'],
          ['Keep planning', 'deny'],
        ] as const) {
          const button = el('button', c.action, label);
          button.type = 'button';
          if (decision === 'allow') button.dataset.variant = 'primary';
          button.disabled = locked;
          button.addEventListener('click', () => void send(form, { decision }));
          actions.append(button);
        }
      } else {
        const button = el('button', c.action, 'Send answer');
        button.type = 'submit';
        button.dataset.variant = 'primary';
        const ready = () => {
          const answer = read(body, form);
          button.disabled = locked || !answer;
        };
        body.addEventListener('input', ready);
        body.addEventListener('submit', (event) => {
          event.preventDefault();
          const answer = read(body, form);
          if (answer && !locked) void send(form, answer);
        });
        actions.append(button);
        ready();
      }
      for (const control of body.querySelectorAll<HTMLInputElement>('input'))
        control.disabled = locked;
      body.append(actions);
    }
    node.append(...lines);
    // A rebuilt card keeps the person's unsent choices.
    if (cached && open && !('folded' in cached.node.dataset)) carry(cached.node, node);
    cards.set(form.formId, { node, seen });
    return node;
  }

  function gone(entry: Sent, memberName: string): HTMLElement {
    const node = el('section', `${c.card} ops-form`);
    node.dataset.formId = entry.formId;
    node.setAttribute('aria-label', 'Answered form');
    node.append(el('p', `${c.cardTitle} ops-form-text`, entry.asked));
    const said = outcome(entry, memberName);
    if (said) node.append(said);
    return node;
  }

  return {
    async refresh() {
      try {
        const forms = await client();
        const next = await forms.cursor();
        if (status !== 'ready' || next.cursor !== cursor) {
          const read = await forms.list();
          list = [...read.forms].sort((a, b) => a.openedMs - b.openedMs);
          cursor = next.cursor;
          status = 'ready';
          const live = new Set(list.map((form) => form.formId));
          for (const id of cards.keys()) if (!live.has(id)) cards.delete(id);
          for (const id of opened) if (!live.has(id)) opened.delete(id);
          // A settled answer whose form closed is finished; an uncertain one stays until it settles.
          for (const [id, entry] of sent)
            if (!live.has(id) && entry.state !== 'uncertain') {
              sent.delete(id);
              drop(id);
            }
          bump();
        }
        for (const entry of sent.values())
          if (
            entry.state === 'uncertain' &&
            !resumed.has(entry.formId) &&
            !busy.has(entry.formId)
          ) {
            resumed.add(entry.formId);
            void check(entry);
          }
        return true;
      } catch {
        // All or nothing: a list that cannot be read is unavailable, never empty.
        const was = status;
        status = 'unavailable';
        cursor = undefined;
        list = [];
        cards.clear();
        if (was !== 'unavailable') bump();
        return false;
      }
    },
    waiting(identityId) {
      return (
        list.filter((form) => form.identityId === identityId).length +
        [...sent.values()].filter(
          (entry) =>
            entry.identityId === identityId &&
            entry.state === 'uncertain' &&
            !list.some((form) => form.formId === entry.formId),
        ).length
      );
    },
    unavailable: () => status === 'unavailable',
    fingerprint: () => `${status}:${version}`,
    view(identityId, memberName) {
      let slot = views.get(identityId);
      if (!slot) {
        slot = el('div', 'ops-forms');
        slot.setAttribute('aria-label', 'Provider forms');
        // Open cards scroll in a bounded box; folded rows stay below it, so every form is in view.
        slot.append(el('div', 'ops-forms-open'), el('div', 'ops-forms-folded'));
        views.set(identityId, slot);
      }
      const [openBox, foldedBox] = [...slot.children] as [HTMLElement, HTMLElement];
      const open: HTMLElement[] = [];
      const rows: HTMLElement[] = [];
      if (status === 'unavailable')
        open.push(
          el('p', 'ops-detail-note', 'Provider forms unavailable. This page tries again shortly.'),
        );
      list
        .filter((form) => form.identityId === identityId)
        .forEach((form, index) =>
          index === 0 || opened.has(form.formId) || sent.has(form.formId)
            ? open.push(card(form, memberName))
            : rows.push(folded(form)),
        );
      for (const entry of sent.values())
        if (
          entry.identityId === identityId &&
          entry.state === 'uncertain' &&
          !list.some((form) => form.formId === entry.formId)
        )
          open.push(gone(entry, memberName));
      for (const [box, parts] of [
        [openBox, open],
        [foldedBox, rows],
      ] as const) {
        if (
          parts.length !== box.children.length ||
          parts.some((part, i) => box.children[i] !== part)
        )
          box.replaceChildren(...parts);
        box.hidden = parts.length === 0;
      }
      slot.hidden = open.length + rows.length === 0;
      return slot;
    },
  };
}

/** The answer the controls hold, or nothing until every question has one. */
function read(body: HTMLFormElement, form: ProviderForm): FormAnswer | undefined {
  const questions = form.questions ?? [];
  const choices: number[][] = [];
  const other: (string | null)[] = [];
  for (let index = 0; index < questions.length; index++) {
    const name = `ops-form-${form.formId}-${index}`;
    const picked = [...body.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)]
      .filter((input) => input.checked)
      .map((input) => Number(input.value));
    const typed = body.querySelector<HTMLInputElement>(`input[name="${name}-other"]`)?.value.trim();
    if (!picked.length && !typed) return undefined;
    choices.push(picked);
    other.push(typed || null);
  }
  return other.some((text) => text !== null) ? { choices, other } : { choices };
}

function carry(from: HTMLElement, to: HTMLElement): void {
  for (const input of from.querySelectorAll<HTMLInputElement>('input')) {
    const twin = [...to.querySelectorAll<HTMLInputElement>('input')].find(
      (candidate) =>
        candidate.name === input.name && (input.type === 'text' || candidate.value === input.value),
    );
    if (!twin) continue;
    if (input.type === 'text') twin.value = input.value;
    else twin.checked = input.checked;
  }
  to.querySelector('form')?.dispatchEvent(new Event('input'));
}
