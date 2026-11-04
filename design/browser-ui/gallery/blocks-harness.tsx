import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ConnectedWorkBundle,
  ImageBlock,
  MockupBlock,
  PageView,
  PageViewToolbar,
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

export function mountPageView() {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  createRoot(host).render(<PageView title="Spec pages" rows={[
    { id: 'one', name: 'First page', title: 'First page', projects: ['spec'], stage: { id: 'waiting', label: 'Waiting' }, updated: 'Today', author: 'Ben', access: 'Team' },
    { id: 'two', name: 'Second page', title: 'Second page', projects: ['spec'], stage: { id: 'active', label: 'Active' }, updated: 'Yesterday', author: 'Night', access: 'Team' },
  ]} />);
}

export function mountImages(layout: 'carousel' | 'grid' | 'single' = 'carousel') {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  createRoot(host).render(
    <ImageBlock
      layout={layout}
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
    subscribe(
      _page: string,
      _signal: AbortSignal,
      publish: (
        data: { title: string; href: string; summary: string; needsYou: boolean } | undefined,
      ) => void,
    ) {
      changed = () =>
        publish(
          available
            ? { title, href: '/pages/page-1', summary: 'Page summary', needsYou: true }
            : undefined,
        );
      changed();
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
export function mountRacingWorkBundle() {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  const pending = new Map<string, (value: { title: string; href: string }) => void>();
  const source = {
    subscribe(
      page: string,
      _signal: AbortSignal,
      publish: (value: { title: string; href: string }) => void,
    ) {
      pending.set(page, publish);
      return () => {};
    },
  };
  function Fixture() {
    const [page, setPage] = useState('first');
    return (
      <>
        <button type="button" onClick={() => setPage('second')}>
          Change page
        </button>
        <button
          type="button"
          onClick={() => pending.get('first')?.({ title: 'Stale first', href: '/first' })}
        >
          Resolve first
        </button>
        <button
          type="button"
          onClick={() => pending.get('second')?.({ title: 'Current second', href: '/second' })}
        >
          Resolve second
        </button>
        <ConnectedWorkBundle page={page} source={source} />
      </>
    );
  }
  createRoot(host).render(<Fixture />);
}

export function mountAnsweredQuestion() {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  createRoot(host).render(
    <QuestionBlock
      title="Which screen first?"
      agent="gui-lead"
      state="answered"
      answer="Insert menu"
      choices={['Insert menu', 'Block handle']}
      onSend={() => {}}
      onFollowUp={() => {}}
    />,
  );
}

export function mountPageViewToolbar() {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  function Fixture() {
    const [filters, setFilters] = useState([{ id: 'project', label: 'Project: gui' }]);
    const [groupBy, setGroupBy] = useState<'state' | 'project' | 'owner' | 'none'>('state');
    const [visible, setVisible] = useState<readonly string[]>(['title', 'state', 'updated']);
    const columns = [
      { id: 'title', label: 'Title', required: true },
      { id: 'state', label: 'State' },
      { id: 'updated', label: 'Updated' },
    ].map((column) => ({ ...column, visible: visible.includes(column.id) }));
    return (
      <>
        <PageViewToolbar
          title="Spec pages"
          filters={filters}
          groupBy={groupBy}
          columns={columns}
          onRemoveFilter={(id) => setFilters((old) => old.filter((item) => item.id !== id))}
          onGroupChange={setGroupBy}
          onColumnsChange={setVisible}
        />
        <output data-columns="">{visible.join(',')}</output>
      </>
    );
  }
  createRoot(host).render(<Fixture />);
}
export function mountConfigurableMockup() {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  function Fixture() {
    const [system, setSystem] = useState('tmt-gui');
    const [version, setVersion] = useState('follow');
    const [setting, setSetting] = useState('390:viewer');
    return (
      <>
        <MockupBlock
          system={system}
          version={version}
          height={240}
          systems={[
            { id: 'tmt-gui', name: 'tmt GUI', versions: ['0.1.0'] },
            { id: 'brio', name: 'Brio', versions: ['2.0.0'] },
          ]}
          onSystemChange={(next) => {
            setSystem(next);
            setVersion('follow');
          }}
          onVersionChange={setVersion}
          onSettingsChange={(next) => setSetting(`${next.width}:${next.theme}`)}
        >
          <button>Stage part</button>
        </MockupBlock>
        <output data-setting="">{`${system}@${version}:${setting}`}</output>
      </>
    );
  }
  createRoot(host).render(<Fixture />);
}
