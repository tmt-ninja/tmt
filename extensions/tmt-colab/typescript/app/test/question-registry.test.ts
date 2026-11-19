import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';
import { validatePageCreator, validateQuestionRegistry } from '../src/question-registry.js';

const corpus = JSON.parse(
  readFileSync(
    new URL('../../../contracts/vectors/question-metadata-v1.json', import.meta.url),
    'utf8',
  ),
) as { cases: { name: string; kind: 'creator' | 'questions'; value: unknown; valid: boolean }[] };

for (const entry of corpus.cases)
  test(`question metadata: ${entry.name}`, () => {
    const validate = () =>
      entry.kind === 'creator'
        ? validatePageCreator(entry.value)
        : validateQuestionRegistry(entry.value);
    if (entry.valid) expect(validate).not.toThrow();
    else expect(validate).toThrow();
  });

import { questionStates, type RegisteredQuestion } from '../src/question-registry.js';
import { validateDiscussionRecord, type ThreadView } from '../src/thread-records.js';

const answers = JSON.parse(
  readFileSync(
    new URL('../../../contracts/vectors/question-answers-v1.json', import.meta.url),
    'utf8',
  ),
) as {
  cases: {
    name: string;
    registry: RegisteredQuestion[];
    threads: {
      writer: string;
      id: string;
      deleted: boolean;
      comments: Record<string, unknown>[];
    }[];
    deviceWriters: string[];
    expected: unknown;
    pending: string[];
  }[];
};
for (const entry of answers.cases)
  test(`verified question answers: ${entry.name}`, () => {
    const threads = entry.threads.map((thread) => ({
      deleted: thread.deleted,
      comments: thread.comments.map((comment) => ({
        ...comment,
        ref: { writer: comment.writer, id: comment.id },
        deviceAuthor: entry.deviceWriters.includes(comment.writer as string),
      })),
    })) as ThreadView[];
    const states = questionStates(entry.registry, threads);
    expect(states).toEqual(entry.expected);
    expect(
      states.filter((question) => question.state === 'open').map((question) => question.id),
    ).toEqual(entry.pending);
    expect(entry.registry.every((question) => question.state !== ('answered' as string))).toBe(
      true,
    );
  });

test('question bindings on ordinary signed comments use the existing question UUID grammar', () => {
  const vector = JSON.parse(
    readFileSync(new URL('../../../contracts/vectors/discussion-v1.json', import.meta.url), 'utf8'),
  );
  const comment = { ...vector.comment, questionId: '00000000-0000-0000-0000-000000000001' };
  const key = `${comment.messageId}:${comment.revision}`;
  expect(() => validateDiscussionRecord('messages', key, comment)).not.toThrow();
  for (const questionId of [null, '', 'not-a-question', 'ABCDEF00-0000-0000-0000-000000000001'])
    expect(() => validateDiscussionRecord('messages', key, { ...comment, questionId })).toThrow();
});

import { verifiedQuestionStates } from '../src/question-registry.js';
import { answerToForm } from '../src/question-form.js';
import type { Question } from '../src/questions.js';

test('editing one group member preserves the other answer and restoring its wording restores its answer', () => {
  const registry = answers.cases[0].registry;
  const forms: Question[] = registry.map((entry) => ({
    id: entry.id,
    title: entry.title!,
    kind: 'single',
    choices: [{ label: 'Beta' }],
    other: false,
    agent: '',
    group: entry.group!,
    label: null,
  }));
  const threads = forms.map((form) => ({
    deleted: false,
    comments: [
      {
        questionId: form.id,
        deviceAuthor: true,
        deleted: false,
        sequence: '1',
        revision: '1',
        ref: { writer: registry[0].attribution.writerId, id: form.id },
        answeredForm: answerToForm(form, 'Beta'),
      },
    ],
  })) as ThreadView[];
  const edited = [{ ...forms[0], title: 'Where should this ship?' }, forms[1]];
  const [first, second] = questionStates(registry, threads, edited);
  expect(first.state).toBe('open');
  expect(first.answer).toBeUndefined();
  expect(first.earlierAnswer?.answeredForm).toEqual(answerToForm(forms[0], 'Beta'));
  expect(second).toMatchObject({ state: 'answered', answer: 'Beta' });
  expect(questionStates(registry, threads, forms)[0]).toMatchObject({
    state: 'answered',
    answer: 'Beta',
  });
});

test('unknown discussion never projects unanswered registrations, including removed source', () => {
  const registry = answers.cases[0].registry;
  expect(verifiedQuestionStates({ questions: registry })).toBeUndefined();
  expect(
    verifiedQuestionStates({ questions: registry, threads: [], discussionPending: true }),
  ).toBeUndefined();
  expect(verifiedQuestionStates({ questions: registry, threads: [] })).toEqual(registry);
  expect(verifiedQuestionStates({ threads: [] })).toBeUndefined();
  expect(verifiedQuestionStates({ questions: [], threads: [] })).toEqual([]);
});
