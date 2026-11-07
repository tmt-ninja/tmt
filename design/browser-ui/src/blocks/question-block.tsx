import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Textarea, UiTheme } from '../ui/index.js';

export interface QuestionBlockProps {
  title: string;
  agent: string;
  kind?: 'single' | 'multiple' | 'short';
  choices?: readonly string[];
  /** Whether an Other answer may be written beside the choices (the default). */
  other?: boolean;
  otherMax?: number;
  state?: 'waiting' | 'answered' | 'dismissed';
  answer?: string;
  busy?: boolean;
  error?: string;
  onSend?(answer: { choices: string[]; other?: string; text?: string }): void;
  onRetry?(): void;
  onUndo?(): void;
  onFollowUp?(): void;
}

/** The host owns answer persistence; this part owns only its in-progress selection and text. */
export function QuestionBlock({
  title,
  agent,
  kind = 'single',
  choices = [],
  other: otherAllowed = true,
  otherMax = 200,
  state = 'waiting',
  answer,
  busy = false,
  error,
  onSend,
  onRetry,
  onUndo,
  onFollowUp,
}: QuestionBlockProps) {
  const id = useId();
  const text = useRef<HTMLTextAreaElement>(null);
  const otherChoice = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [other, setOther] = useState(false);
  const [value, setValue] = useState('');
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (other) text.current?.focus();
  }, [other]);
  if (state === 'dismissed')
    return (
      <div className="tmt-block-question-dismissed">
        Question removed{' '}
        {onUndo && (
          <button type="button" onClick={onUndo}>
            Undo
          </button>
        )}
      </div>
    );
  if (state === 'answered' && !expanded)
    return (
      <button
        className="tmt-block-question-answered"
        type="button"
        aria-expanded={false}
        onClick={() => setExpanded(true)}
      >
        <span aria-hidden="true">✓</span>
        <span>{title}</span>
        <span>{answer}</span>
      </button>
    );
  const valid =
    kind === 'short'
      ? !!value.trim()
      : (selected.length > 0 || other) && (!other || !!value.trim());
  const send = () => {
    if (valid && !busy)
      onSend?.({
        choices: selected,
        ...(other ? { other: value.trim() } : {}),
        ...(kind === 'short' ? { text: value.trim() } : {}),
      });
  };
  const choose = (choice: string, checked: boolean) => {
    if (kind === 'single') {
      setSelected([choice]);
      setOther(false);
      setValue('');
    } else
      setSelected((previous) =>
        checked ? [...previous, choice] : previous.filter((item) => item !== choice),
      );
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      send();
    }
    if (event.key === 'Escape' && other) {
      event.preventDefault();
      setOther(false);
      setValue('');
      otherChoice.current?.focus();
      return;
    }
    if (
      kind !== 'short' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !(event.target instanceof HTMLTextAreaElement) &&
      !(
        event.target instanceof HTMLInputElement &&
        !['radio', 'checkbox'].includes(event.target.type)
      ) &&
      /^[1-9]$/.test(event.key)
    ) {
      const index = Number(event.key) - 1;
      if (index === choices.length && otherAllowed) {
        event.preventDefault();
        setOther(true);
        if (kind === 'single') setSelected([]);
      } else if (choices[index] !== undefined) {
        event.preventDefault();
        const choice = choices[index]!;
        choose(choice, !selected.includes(choice));
      }
    }
  };
  return (
    <UiTheme>
      <section className="tmt-block-question" role="group" aria-label={title} onKeyDown={keys}>
        <div className="tmt-block-question-mark" aria-hidden="true">
          ?
        </div>
        <div className="tmt-block-question-content">
          {state === 'answered' && (
            <button
              className="tmt-block-question-answered"
              type="button"
              aria-expanded={true}
              onClick={() => setExpanded(false)}
            >
              <span aria-hidden="true">✓</span>
              <span>{title}</span>
              <span>{answer}</span>
            </button>
          )}
          <div className="tmt-block-question-eyebrow">
            {state === 'answered' ? '✓ Answered' : '◆ Waiting for your answer'}
            {/* No agent is asked: the answer stays on the page, and no name follows. */}
            {agent && <> · {agent}</>}
          </div>
          <h3>{title}</h3>
          {kind !== 'short' && (
            <fieldset className="tmt-ui-choices" data-layout="inline">
              <legend className="tmt-ui-choices-legend">Choices</legend>
              <div className="tmt-block-question-choices">
                {choices.map((choice, index) => (
                  <label className="tmt-ui-choice" key={`${choice}-${index}`}>
                    <input
                      type={kind === 'multiple' ? 'checkbox' : 'radio'}
                      className={kind === 'multiple' ? 'tmt-ui-checkbox' : 'tmt-ui-radio'}
                      aria-label={choice}
                      aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
                      name={id}
                      checked={selected.includes(choice)}
                      onChange={(event) => choose(choice, event.target.checked)}
                    />
                    <span className="tmt-ui-choice-text">{choice}</span>
                    {index < 9 && (
                      <kbd className="tmt-ui-choice-hint" aria-hidden="true">
                        {index + 1}
                      </kbd>
                    )}
                  </label>
                ))}
                {otherAllowed && (
                  <label className="tmt-ui-choice">
                    <input
                      type={kind === 'multiple' ? 'checkbox' : 'radio'}
                      className={kind === 'multiple' ? 'tmt-ui-checkbox' : 'tmt-ui-radio'}
                      ref={otherChoice}
                      aria-label="Other…"
                      aria-keyshortcuts={
                        choices.length < 9 ? String(choices.length + 1) : undefined
                      }
                      name={id}
                      checked={other}
                      onChange={(event) => {
                        setOther(event.target.checked);
                        if (kind === 'single') setSelected([]);
                        if (!event.target.checked) setValue('');
                      }}
                    />
                    <span className="tmt-ui-choice-text">Other…</span>
                    {choices.length < 9 && (
                      <kbd className="tmt-ui-choice-hint" aria-hidden="true">
                        {choices.length + 1}
                      </kbd>
                    )}
                  </label>
                )}
              </div>
            </fieldset>
          )}
          {(kind === 'short' || other) && (
            <div className="tmt-block-question-input">
              <Textarea
                ref={text}
                aria-label={kind === 'short' ? 'Your answer' : 'Other: your answer'}
                aria-describedby={`${id}-count`}
                placeholder="Write your answer"
                value={value}
                onChange={(event) => {
                  setValue(Array.from(event.target.value).slice(0, otherMax).join(''));
                  if (kind !== 'short' && !event.target.value && value) {
                    setOther(false);
                    otherChoice.current?.focus();
                  }
                }}
                rows={1}
              />
              <span id={`${id}-count`}>
                {Array.from(value).length >= otherMax * 0.8
                  ? `${Array.from(value).length} / ${otherMax}`
                  : ''}
              </span>
            </div>
          )}
          {error && (
            <div role="alert">
              {error}
              {onRetry && (
                <button type="button" onClick={onRetry}>
                  Retry
                </button>
              )}
            </div>
          )}
          <Button
            type="button"
            disabled={!valid || busy || !onSend}
            aria-disabled={!valid || busy || !onSend}
            onClick={send}
          >
            Send
          </Button>
          {state === 'answered' && onFollowUp && (
            <button type="button" onClick={onFollowUp}>
              Follow up
            </button>
          )}
        </div>
      </section>
    </UiTheme>
  );
}
