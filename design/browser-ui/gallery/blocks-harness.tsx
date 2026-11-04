import { createRoot } from 'react-dom/client';
import {
  ConnectedWorkBundle,
  ImageBlock,
  MockupBlock,
  QuestionBlock,
} from '../src/blocks/index.js';
import '../src/blocks/blocks.css';

/** A private browser harness exercises the real component and records host callbacks. */
export function mountQuestion(kind: 'single' | 'multiple' | 'short' = 'single') {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  const result = document.createElement('output');
  result.dataset.answer = '';
  document.body.append(result);
  createRoot(host).render(
    <QuestionBlock
      kind={kind}
      title="Which screen first?"
      agent="gui-lead"
      choices={['Insert menu', 'Block handle']}
      onSend={(answer) => {
        result.textContent = JSON.stringify(answer);
      }}
    />,
  );
}

export function mountImages() {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  createRoot(host).render(
    <ImageBlock
      images={[
        { src: pixel, alt: 'First', caption: 'First image' },
        { src: pixel, alt: 'Second', caption: 'Second image' },
      ]}
    />,
  );
}

export function mountMockup() {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  host.style.width = '300px';
  createRoot(host).render(
    <MockupBlock system="tmt-gui" version="0.1.0" height={400}>
      <button type="button">Inside stage</button>
    </MockupBlock>,
  );
}
export function mountScopedImages() {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  createRoot(host).render(
    <>
      <button
        type="button"
        onClick={(event) => {
          event.currentTarget.textContent = 'Outside clicked';
        }}
      >
        Outside
      </button>
      <MockupBlock width={390} height={360}>
        <ImageBlock images={[{ src: pixel, alt: 'First', caption: 'First image' }]} />
      </MockupBlock>
    </>,
  );
}

export function mountWorkBundle() {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  let title = 'Initial page';
  let available = true;
  let changed = () => {};
  const source = {
    async read() {
      return available
        ? { title, href: '/pages/page-1', summary: 'Page summary', needsYou: true }
        : undefined;
    },
    watch(_page: string, next: () => void) {
      changed = next;
      return () => {
        changed = () => {};
      };
    },
  };
  createRoot(host).render(
    <>
      <button
        type="button"
        onClick={() => {
          title = 'Updated page';
          changed();
        }}
      >
        Change source
      </button>
      <button
        type="button"
        onClick={() => {
          available = false;
          changed();
        }}
      >
        Remove access
      </button>
      <ConnectedWorkBundle
        page="page-1"
        number={3}
        source={source}
        work="Keep this work"
        tickets={[{ label: '#12', href: 'https://github.com/tmt-ninja/tmt/issues/12' }]}
        onOpenTicket={() => {}}
      />
    </>,
  );
}
