import { sha256Hex } from './sha256.js';
import type { Question } from './questions.js';
import type { BlockRecord } from './block-model.js';
import type { CommentView } from './thread-records.js';

export function blockQuestion(block: Pick<BlockRecord, 'id' | 'props' | 'text'>): Question {
  const { kind, choices, agent, other } = block.props;
  const mode = kind === 'multiple' || kind === 'short' ? kind : 'single';
  return {
    id: block.id,
    title: block.text ?? '',
    kind: mode,
    choices:
      mode !== 'short' && Array.isArray(choices)
        ? choices
            .filter((choice): choice is string => typeof choice === 'string')
            .slice(0, 20)
            .map((label) => ({ label }))
        : [],
    other: mode !== 'short' && other === true,
    agent: typeof agent === 'string' ? agent : '',
    group: null,
    label: null,
  };
}

export type QuestionForm = [1, string, Question['kind'], [string, string | null][]];

export class StaleQuestionFormError extends Error {}

export function answerApplies(recorded: string | null, current: string | null): boolean {
  return current === null || recorded === current;
}

export function commentApplies(comment: CommentView, current: string | null): boolean {
  if (comment.formBinding === 'superseded') return false;
  return !comment.formBinding || answerApplies(comment.formBinding.digest, current);
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
