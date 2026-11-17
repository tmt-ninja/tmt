/** Provider forms on the owner's existing signed Session. Only the person answers;
 * construction, reads and recovery never answer, retry delivery or open a Session. */
import type { Session } from './device.js';
import { coreId, verifiedSessionRequest } from './operations.js';
export interface FormOption {
  label: string;
  description?: string;
}
export interface FormQuestion {
  text: string;
  header?: string;
  choice: 'single' | 'multiple';
  options: FormOption[];
  freeText: boolean;
}
export interface ProviderForm {
  formId: string;
  identityId: string;
  openedMs: number;
  kind: 'question' | 'permission' | 'planApproval';
  questions?: FormQuestion[];
  tool?: { name: string; summary: string };
  plan?: string;
  truncated: boolean;
  answerable: boolean;
  answerIn: 'client' | 'terminal';
}
export type FormAnswer =
  | { choices: number[][]; other?: (string | null)[] }
  | { decision: 'allow' | 'deny' };
export interface FormAnswerInput {
  operationId: string;
  formId: string;
  answer: FormAnswer;
}
export type FormAnswerState = { operationId: string; formId: string } & (
  | { state: 'accepted'; delivered: true }
  | { state: 'refused' | 'uncertain'; reason: string; message?: string }
);
export interface FormsCursor {
  cursor: number;
  usage?: number;
}
export interface RemoteForms {
  list(input?: { identityId?: string }): Promise<{ forms: ProviderForm[] }>;
  cursor(): Promise<FormsCursor>;
  answer(input: FormAnswerInput): Promise<FormAnswerState>;
  operation(operationId: string): Promise<FormAnswerState>;
}
// Remote's limits.rs mirrors the existing public Core content bounds; never truncate here.
const TEXT = 2048,
  LABEL = 256,
  PLAN = 64 * 1024,
  RESPONSE = 1024 * 1024,
  ANSWER = 16 * 1024,
  QUESTIONS = 4,
  OPTIONS = 8;
const utf8 = new TextEncoder();
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && utf8.encode(v).length <= max;
function valid(v: unknown): asserts v {
  if (!v) throw new TypeError('Invalid provider form document.');
}
function object(v: unknown): Record<string, unknown> {
  valid(v !== null && typeof v === 'object' && !Array.isArray(v));
  return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, required: string[], optional: string[] = []): void {
  valid(
    required.every((k) => Object.hasOwn(v, k)) &&
      Object.keys(v).every((k) => required.includes(k) || optional.includes(k)),
  );
}
function size(value: unknown, max: number): void {
  valid(utf8.encode(JSON.stringify(value)).length <= max);
}
function parseForm(value: unknown): ProviderForm {
  const f = object(value);
  keys(
    f,
    ['formId', 'identityId', 'openedMs', 'kind', 'truncated', 'answerable', 'answerIn'],
    ['questions', 'tool', 'plan'],
  );
  valid(
    coreId(f.formId) &&
      coreId(f.identityId) &&
      integer(f.openedMs) &&
      ['question', 'permission', 'planApproval'].includes(f.kind as string) &&
      typeof f.truncated === 'boolean' &&
      typeof f.answerable === 'boolean' &&
      ['client', 'terminal'].includes(f.answerIn as string) &&
      f.answerable === (f.answerIn === 'client'),
  );
  if (f.questions !== undefined) {
    valid(Array.isArray(f.questions) && f.questions.length <= QUESTIONS);
    for (const value of f.questions) {
      const q = object(value);
      keys(q, ['text', 'choice', 'options', 'freeText'], ['header']);
      valid(
        text(q.text, TEXT) &&
          (q.header === undefined || text(q.header, LABEL)) &&
          ['single', 'multiple'].includes(q.choice as string) &&
          typeof q.freeText === 'boolean' &&
          Array.isArray(q.options) &&
          q.options.length <= OPTIONS,
      );
      for (const value of q.options) {
        const o = object(value);
        keys(o, ['label'], ['description']);
        valid(text(o.label, LABEL) && (o.description === undefined || text(o.description, TEXT)));
      }
    }
  }
  if (f.plan !== undefined) valid(text(f.plan, PLAN));
  if (f.tool !== undefined) {
    const t = object(f.tool);
    keys(t, ['name', 'summary']);
    valid(text(t.name, TEXT) && text(t.summary, TEXT));
  }
  return structuredClone(f) as unknown as ProviderForm;
}
function parseList(value: unknown, identityId?: string): { forms: ProviderForm[] } {
  size(value, RESPONSE);
  const v = object(value);
  keys(v, ['forms']);
  valid(Array.isArray(v.forms));
  const forms = v.forms.map(parseForm);
  valid(new Set(forms.map((f) => f.formId)).size === forms.length);
  valid(identityId === undefined || forms.every((f) => f.identityId === identityId));
  return { forms };
}
function parseCursor(value: unknown): FormsCursor {
  const v = object(value);
  keys(v, ['cursor'], ['usage']);
  valid(integer(v.cursor) && (v.usage === undefined || integer(v.usage)));
  return { cursor: v.cursor, ...(v.usage === undefined ? {} : { usage: v.usage as number }) };
}
function parseState(value: unknown, operationId: string, formId?: string): FormAnswerState {
  const v = object(value);
  keys(
    v,
    ['operationId', 'formId', 'state'],
    v.state === 'accepted' ? ['delivered'] : ['reason', 'message'],
  );
  valid(
    v.operationId === operationId &&
      coreId(v.formId) &&
      (formId === undefined || v.formId === formId),
  );
  if (v.state === 'accepted') valid(v.delivered === true);
  else
    valid(
      ['refused', 'uncertain'].includes(v.state as string) &&
        typeof v.reason === 'string' &&
        /^[A-Z_]{1,64}$/.test(v.reason) &&
        (v.message === undefined ||
          (text(v.message, TEXT) &&
            [...v.message].every((char) => {
              const code = char.codePointAt(0)!;
              return code >= 32 && (code < 127 || code > 159);
            }))),
    );
  return { ...v } as FormAnswerState;
}
function checkedAnswer(value: FormAnswerInput): void {
  const v = object(value);
  keys(v, ['operationId', 'formId', 'answer']);
  valid(coreId(v.operationId) && coreId(v.formId));
  const a = object(v.answer);
  size(a, ANSWER);
  if (Object.hasOwn(a, 'decision')) {
    keys(a, ['decision']);
    valid(a.decision === 'allow' || a.decision === 'deny');
  } else {
    keys(a, ['choices'], ['other']);
    valid(Array.isArray(a.choices) && a.choices.length <= QUESTIONS);
    for (const q of a.choices) valid(Array.isArray(q) && q.length <= OPTIONS && q.every(integer));
    if (a.other !== undefined)
      valid(
        Array.isArray(a.other) &&
          a.other.length <= QUESTIONS &&
          a.other.every((t) => t === null || text(t, TEXT)),
      );
  }
  // Which option exists, free-text policy and form freshness remain Core's decision.
}
export function forms(session: Session, options: { timeoutMs?: number } = {}): RemoteForms {
  const call = verifiedSessionRequest(session, options);
  return {
    list(input = {}) {
      const v = object(input);
      keys(v, [], ['identityId']);
      valid(input.identityId === undefined || coreId(input.identityId));
      const scope = input.identityId;
      return call(
        'forms.list',
        crypto.randomUUID(),
        {
          version: 1,
          operation: 'forms.list',
          input: scope === undefined ? {} : { identityId: scope },
        },
        (v) => parseList(v, scope),
      );
    },
    cursor: () =>
      call(
        'changes.cursor',
        crypto.randomUUID(),
        { version: 1, operation: 'changes.cursor', input: {} },
        parseCursor,
      ),
    answer(input) {
      checkedAnswer(input);
      const { operationId, formId } = input;
      return call(
        'forms.answer',
        operationId,
        { version: 1, operation: 'forms.answer', input },
        (v) => parseState(v, operationId, formId),
        true,
      );
    },
    operation(operationId) {
      valid(coreId(operationId));
      return call('operation.show', crypto.randomUUID(), { operationId }, (v) =>
        parseState(v, operationId),
      );
    },
  };
}
