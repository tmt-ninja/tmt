import { ConversationPresentation } from '../src/components/conversation-presentation.js';
/** Chat composer and row-menu doubles: prefill sources, a blocked Enter, IME, and the ⋯ menu. */
import { createRoot, type Root } from 'react-dom/client';
import { AnnotationInput } from '../src/annotation-input.js';
import type { AskBinding } from '../src/ask-panel.js';
import { ConversationTurn } from '../src/components/conversation-turn.js';
import { BrowserMenu } from '@tmt/browser-ui/react';
import type { ThreadBinding } from '../src/thread-store.js';
import { destination, id } from './ask-fixtures.js';
import { PendingMessageContext, type PendingMessageStore } from '../src/draft-store.js';

let root: Root | undefined;
let createChats = 0;
let selected: string[] = [];
let releasePending: (() => void) | undefined;
let pendingCalls = 0;

function host() {
  root?.unmount();
  document.getElementById('chat-fixture')?.remove();
  document.getElementById('root')?.setAttribute('hidden', '');
  const main = document.createElement('main');
  main.id = 'chat-fixture';
  document.body.append(main);
  createChats = 0;
  selected = [];
  releasePending = undefined;
  pendingCalls = 0;
  return main;
}

export function mountComposer(options: { agents: string[]; pending?: 'refuse' | 'hold' }) {
  const base = destination();
  const agents = options.agents.map((agentName, index) => ({
    ...base,
    agent: id(20 + index),
    agentName,
  }));
  const binding: AskBinding = {
    async destinations() {
      return agents;
    },
    async prepare() {
      throw new Error('Not used');
    },
    async recheck() {},
    async sendNow() {},
    async abandon() {},
  };
  const discussion = {
    deviceId: id(4),
    async createChat() {
      createChats++;
      throw new Error('Counted');
    },
  } as unknown as ThreadBinding;
  const pending: PendingMessageStore | undefined = options.pending
    ? {
        async retain() {
          pendingCalls++;
          if (options.pending === 'refuse') return undefined;
          await new Promise<void>((resolve) => {
            releasePending = resolve;
          });
          return 'unconfirmed:chat:fixture';
        },
        async clear() {},
      }
    : undefined;
  root = createRoot(host());
  root.render(
    <PendingMessageContext value={pending}>
      <ConversationPresentation value="chat">
        <AnnotationInput
          binding={binding}
          discussion={discussion}
          anchor={null}
          asks={[]}
          title="Chat page"
          initialEdit={{ value: '', edited: true }}
          blocked={false}
          cancel={() => {}}
          committed={() => {}}
        />
      </ConversationPresentation>
    </PendingMessageContext>,
  );
}

export function mountMenu(options: { tight?: boolean; spaceAbove?: boolean } = {}) {
  root = createRoot(host());
  const row = (
    <ConversationTurn
      role="user"
      author="You"
      at={Date.now()}
      className="comment"
      data-testid="row"
      style={{ width: 360, padding: 16 }}
      actions={
        <>
          <span role="status">replied</span>
          <BrowserMenu
            label="Message actions"
            items={[
              { key: 'edit', label: 'Edit' },
              { key: 'delete', label: 'Delete' },
            ]}
            onSelect={(key) => selected.push(key)}
          />
        </>
      }
    >
      <p>First line of a message.</p>
      <button type="button">After</button>
    </ConversationTurn>
  );
  // The small viewport either has room above the row or needs an in-viewport menu.
  root.render(
    options.tight ? (
      <div
        data-testid="menu-viewport"
        style={{ height: options.spaceAbove ? 240 : 120, overflowY: 'auto', marginTop: 200 }}
      >
        {options.spaceAbove && <div style={{ height: 120 }} />}
        {row}
      </div>
    ) : (
      row
    ),
  );
}

export function proof() {
  return { createChats, selected, pendingCalls };
}
export function releaseRecovery() {
  releasePending?.();
}
