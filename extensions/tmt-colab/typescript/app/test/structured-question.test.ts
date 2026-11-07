import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vite-plus/test';
import type { BlockRecord } from '../src/block-model.js';
import { posBetween } from '../src/block-pos.js';
import { BlockTree } from '../src/block-tree.js';
import type { RegisteredQuestion } from '../src/question-registry.js';
import { text } from '../src/strings.js';
import { StructuredPage } from '../src/structured-page.js';
import type { QuestionPage } from '../src/structured-question.js';
import type { ThreadBinding } from '../src/thread-store.js';

const question: BlockRecord = {
  id: '7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
  type: 'question',
  parent: 'root',
  pos: posBetween(),
  props: { kind: 'single', choices: ['A', 'B'] },
  text: 'Which first?',
  deleted: false,
};
const draw = (page: Partial<QuestionPage>) =>
  renderToStaticMarkup(
    createElement(StructuredPage, {
      tree: new BlockTree([question]),
      questionPage: {
        title: 'Page',
        threads: [],
        discussion: {} as ThreadBinding,
        blocked: false,
        ...page,
      },
    }),
  );
const entry = (agent?: { id: string; name: string }): RegisteredQuestion =>
  ({
    id: '7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
    state: 'open',
    ...(agent && { agent }),
    attribution: { writerId: '30000000-0000-4000-8000-000000000001', timeMs: 1_000 },
  }) as RegisteredQuestion;

it('a question block names its recipient: the registry agent, else the page creator', () => {
  expect(
    draw({ questions: [entry({ id: '50000000-0000-4000-8000-000000000001', name: 'gui-lead' })] }),
  ).toContain('Waiting for your answer · gui-lead');
  expect(
    draw({
      questions: [entry()],
      creator: {
        agent: { id: '50000000-0000-4000-8000-000000000002', name: 'page-creator' },
        attribution: { writerId: '30000000-0000-4000-8000-000000000001', timeMs: 1_000 },
      },
    }),
  ).toContain('Waiting for your answer · page-creator');
});

it('with no agent to ask, the block is an error that cannot send, never a blank name', () => {
  const markup = draw({ questions: [entry()] });
  expect(markup).toContain(`Waiting for your answer · ${text.questionNoAgent}`);
  expect(markup).toContain(text.questionNoRecipient);
  expect(markup).toContain(`<div role="alert">${text.questionNoRecipient}`);
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Send</);
});
