/** Controlled fixture for the recipient picker. The directory, the owner's answer and the seam are
 * injected by the URL, not native proof: `?directory=ready|loading|failed|empty|none`,
 * `&own=1` (the question already has its own agent) and `&answer=applied|refused|refused-once|slow`. */
import 'virtual:tokens.css';
import '@tmt/browser-ui/static.css';
import '../src/style.css';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { AgentDirectory } from '../src/agent-directory.js';
import { QuestionRecipientPicker } from '../src/question-recipient-picker.js';
import { recipientAgents } from '../src/question-recipient.js';
import type { RegisteredQuestion } from '../src/question-registry.js';
import { destination, id } from './ask-fixtures.js';

const params = new URLSearchParams(location.search);
const mode = params.get('directory') ?? 'ready';
const answer = params.get('answer') ?? 'applied';
const attribution = { writerId: id(4), timeMs: 1 };
const agents = [
  ['First reviewer', 6],
  ['Next builder', 7],
  ['An agent with a very long name that has to truncate instead of pushing the line wider', 8],
].map(([agentName, n]) => ({
  ...destination(),
  agent: id(n as number),
  agentName: agentName as string,
  presence: 'offline' as const,
}));
const directory: AgentDirectory =
  mode === 'loading' || mode === 'none'
    ? { state: 'loading' }
    : mode === 'failed'
      ? { state: 'failed', code: 'COLAB_REMOTE_UNAVAILABLE' }
      : { state: 'ready', agents: mode === 'empty' ? [] : agents };
const chosen: (string | null)[] = [];
let retries = 0;
Object.assign(window, { recipientFixture: { chosen, retries: () => retries } });

function Fixture() {
  const [question, setQuestion] = useState<RegisteredQuestion>({
    id: id(55),
    title: 'Which option?',
    state: 'open',
    attribution,
    ...(params.get('own') ? { agent: { id: id(6), name: 'First reviewer' } } : {}),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <main style={{ padding: 16, maxWidth: 480 }}>
      <h1>Which option?</h1>
      <QuestionRecipientPicker
        question={question}
        creatorName="Page creator"
        agents={directory.state === 'ready' ? recipientAgents(directory.agents) : []}
        directory={directory}
        hasDirectory={mode !== 'none'}
        retry={() => {
          retries++;
        }}
        pending={pending}
        error={error}
        onChoose={(agent) => {
          chosen.push(agent);
          setError(undefined);
          setPending(true);
          window.setTimeout(
            () => {
              setPending(false);
              if (answer === 'refused' || (answer === 'refused-once' && chosen.length === 1)) {
                setError('That identity was not found. Check the name or ID and try again.');
                return;
              }
              setQuestion((current) => {
                const { agent: _own, ...rest } = current;
                const found = agents.find((candidate) => candidate.agent === agent);
                return found
                  ? { ...rest, agent: { id: found.agent, name: found.agentName } }
                  : rest;
              });
            },
            answer === 'slow' ? 800 : 0,
          );
        }}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
