import { sha256Hex } from './sha256.js';
import type { Question } from './questions.js';
import type { BlockRecord } from './block-model.js';

export function blockQuestion(block: Pick<BlockRecord, 'id' | 'props' | 'text'>): Question {
  const { kind, choices, agent, other } = block.props;
  const mode = kind === 'multiple' || kind === 'short' ? kind : 'single';
  return {
    id: block.id, title: block.text ?? '', kind: mode,
    choices: mode !== 'short' && Array.isArray(choices)
      ? choices.filter((choice): choice is string => typeof choice === 'string').slice(0, 20).map(label => ({label})) : [],
    other: mode !== 'short' && other === true,
    agent: typeof agent === 'string' ? agent : '', group: null, label: null,
  };
}

export type QuestionForm = [1, string, Question['kind'], [string, string | null][]];

export function answerApplies(recorded: string | null, current: string | null): boolean {
  return current === null || recorded === current;
}

export interface AnsweredForm {
  form: QuestionForm;
  digest: string;
  selection: string;
}

export function answerToForm(question: Question, selection: string): AnsweredForm {
  const form = askedForm(question);
  return { form, digest: formDigest(form), selection };
}

export function validAnsweredForm(value: unknown): value is AnsweredForm {
  if (typeof value !== 'object' || value === null || Object.keys(value).length !== 3) return false;
  const { form, digest, selection } = value as Partial<AnsweredForm>;
  return (
    Array.isArray(form) &&
    form.length === 4 &&
    form[0] === 1 &&
    typeof form[1] === 'string' &&
    ['short', 'long', 'single', 'multiple'].includes(form[2]) &&
    Array.isArray(form[3]) &&
    form[3].length <= 20 &&
    form[3].every(
      (choice) =>
        Array.isArray(choice) &&
        choice.length === 2 &&
        typeof choice[0] === 'string' &&
        (choice[1] === null || typeof choice[1] === 'string'),
    ) &&
    typeof selection === 'string' &&
    typeof digest === 'string' &&
    digest === formDigest(form)
  );
}

export function askedForm(question: Question): QuestionForm {
  return [
    1,
    question.title,
    question.kind,
    question.choices.map(({ label, description }) => [label, description ?? null]),
  ];
}

export function formDigest(form: QuestionForm): string {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(form)));
}
