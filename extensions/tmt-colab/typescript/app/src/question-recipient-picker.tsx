import { BrowserAction } from '@tmt/browser-ui/react';
import { ChevronDown } from 'lucide-react';
import { useState, type Ref } from 'react';
import type { AgentDirectory } from './agent-directory.js';
import { Listbox } from './components/listbox.js';
import { currentRecipient, type RecipientAgent } from './question-recipient.js';
import type { RegisteredQuestion } from './question-registry.js';
import { text } from './strings.js';
import './question-recipient-picker.css';

const t = text.metadata;
/** The option that clears the question's own recipient; no agent has an empty ID. */
const FOLLOWS = '';

/** Who receives a question's answers, with a menu of the agents it can go to. Presentational: the
 * hook owns the directory, the seam and the settle. The page creator is the default; an agent the
 * directory no longer lists keeps its own name so the line never goes blank. */
export function QuestionRecipientPicker({
  question,
  creatorName,
  agents,
  directory,
  hasDirectory,
  retry,
  pending,
  error,
  onChoose,
}: {
  question: RegisteredQuestion;
  creatorName?: string;
  agents: readonly RecipientAgent[];
  directory: AgentDirectory;
  /** An Ask binding to read the directory from exists; without one nothing can be offered. */
  hasDirectory: boolean;
  retry(): void;
  pending: boolean;
  error?: string;
  /** An agent ID, or `null` to follow the page's creator. */
  onChoose(agent: string | null): void;
}) {
  const [open, setOpen] = useState(false);
  const own = currentRecipient(question);
  const follows = t.recipientFollows(creatorName);
  const name = own === null ? follows : (question.agent?.name ?? own);
  const options = [
    { value: FOLLOWS, label: follows },
    ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
    // The current recipient stays selectable-looking even when the directory omits it.
    ...(own !== null && !agents.some((agent) => agent.id === own)
      ? [{ value: own, label: name }]
      : []),
  ];
  const ready = hasDirectory && directory.state === 'ready';
  return (
    <div className="question-recipient" data-pending={pending || undefined}>
      <span className="question-recipient-label">{t.recipient}</span>
      <Listbox
        label={t.recipient}
        options={options}
        value={own ?? FOLLOWS}
        disabled={pending || !ready}
        onChange={(value) => {
          setOpen(false);
          onChoose(value === FOLLOWS ? null : value);
        }}
        popup={{ width: 280, align: 'start', className: 'question-recipient-list' }}
        inputTrigger={{
          open,
          onOpenChange: setOpen,
          render: (trigger) => (
            <button
              {...trigger}
              ref={trigger.ref as Ref<HTMLButtonElement>}
              role={undefined}
              type="button"
              className="question-recipient-trigger"
              aria-label={`${t.recipient}: ${name}`}
              data-own={own !== null || undefined}
              disabled={pending || !ready}
              onClick={(event) => {
                if (event.isTrusted) setOpen(!open);
              }}
            >
              <span>{name}</span>
              <ChevronDown aria-hidden />
            </button>
          ),
        }}
      />
      {directory.state === 'loading' && hasDirectory && <p role="status">{t.loading}</p>}
      {(directory.state === 'failed' || !hasDirectory) && (
        <div className="question-recipient-note" role="status">
          <p>{t.directoryUnavailable(directory.state === 'failed' ? directory.code : undefined)}</p>
          {hasDirectory && (
            <BrowserAction type="button" variant="text" label={t.retry} onActivate={retry} />
          )}
        </div>
      )}
      {ready && agents.length === 0 && <p role="status">{t.recipientNoAgents}</p>}
      {error && (
        <p className="question-recipient-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
