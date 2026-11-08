import { Plus, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
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
  /** A page writer opens the question's editor (an Edit button beside Send). */
  onEdit?(): void;
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
  onEdit,
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
            {state === 'answered' ? '✓ Answered' : '◆ Waiting for your answer'} · {agent}
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
          {onEdit && (
            <Button type="button" variant="ghost" onClick={onEdit}>
              Edit
            </Button>
          )}
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

export interface QuestionBlockEditorProps {
  title: string;
  kind?: 'single' | 'multiple' | 'short';
  choices?: readonly string[];
  /** Who receives the answers. Without one, `error` says why no one can be asked. */
  recipient?: string;
  error?: string;
  /** The most choices a question holds. */
  maxChoices?: number;
  /** Focus the title when the editor opens (the default). */
  autoFocus?: boolean;
  onTitle(title: string): void;
  onKind(kind: 'single' | 'multiple' | 'short'): void;
  onChoices(choices: string[]): void;
  /** The editor closes: Done, Esc, or focus leaving it. Pending text is committed first. */
  onDone(): void;
}

/** A press on the editor's own buttons keeps the field focused, so focus never leaves the editor
 * in between (Safari does not focus a pressed button). */
const keepFocus = (event: { preventDefault(): void }) => event.preventDefault();

const KIND_LABELS = [
  ['single', 'One choice'],
  ['multiple', 'Several'],
  ['short', 'Short answer'],
] as const;

/**
 * A question block's editor: the waiting card's own box, type and rows, with the title and the
 * choices as fields, the answer kind in place of Send, and "Other…" kept as the fixed last choice.
 * The host commits each change; this part holds only the text being typed.
 */
export function QuestionBlockEditor({
  title,
  kind = 'single',
  choices = [],
  recipient,
  error,
  maxChoices = 20,
  autoFocus = true,
  onTitle,
  onKind,
  onChoices,
  onDone,
}: QuestionBlockEditorProps) {
  const section = useRef<HTMLElement>(null);
  const titleField = useRef<HTMLTextAreaElement>(null);
  const [titleDraft, setTitleDraft] = useState(title);
  const [draft, setDraft] = useState<string[]>([...choices]);
  /** The choice field to focus next; -1 is the title. */
  const [focusAt, setFocusAt] = useState<number>();
  // The page's choices come in while no choice is being typed.
  const shown = JSON.stringify(choices);
  useEffect(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement && active.dataset.choiceField !== undefined))
      setDraft(JSON.parse(shown) as string[]);
  }, [shown]);
  useEffect(() => {
    if (document.activeElement !== titleField.current) setTitleDraft(title);
  }, [title]);
  useEffect(() => {
    if (autoFocus) titleField.current?.focus();
    // Only when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    if (focusAt === undefined) return;
    const fields = section.current?.querySelectorAll<HTMLInputElement>('[data-choice-field]');
    (fields?.[focusAt] ?? titleField.current)?.focus();
    setFocusAt(undefined);
  }, [focusAt]);
  const commitChoices = (next: string[] = draft) => {
    onChoices(next.map((choice) => choice.trim()).filter(Boolean));
  };
  const commitTitle = () => {
    if (titleDraft !== title) onTitle(titleDraft);
  };
  const done = () => {
    commitTitle();
    commitChoices();
    onDone();
  };
  const leave = (event: FocusEvent<HTMLElement>) => {
    if (!section.current?.contains(event.relatedTarget as Node | null)) done();
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    // Keys typed here stay out of the page's own shortcuts.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      done();
    }
  };
  const choiceKeys = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!draft[index]?.trim()) return;
      if (draft.length < maxChoices) {
        setDraft([...draft.slice(0, index + 1), '', ...draft.slice(index + 1)]);
        setFocusAt(index + 1);
      }
      commitChoices(draft);
    } else if (event.key === 'Backspace' && !draft[index] && draft.length > 0) {
      event.preventDefault();
      const next = draft.filter((_, at) => at !== index);
      setDraft(next);
      commitChoices(next);
      setFocusAt(index - 1);
    }
  };
  const remove = (index: number) => {
    const next = draft.filter((_, at) => at !== index);
    setDraft(next);
    commitChoices(next);
    setFocusAt(next.length ? Math.min(index, next.length - 1) : -1);
  };
  const add = () => {
    setDraft((previous) => [...previous, '']);
    setFocusAt(draft.length);
  };
  const marker = kind === 'multiple' ? 'tmt-ui-checkbox' : 'tmt-ui-radio';
  return (
    <UiTheme>
      <section
        ref={section}
        className="tmt-block-question"
        data-editing=""
        role="group"
        aria-label="Edit question"
        onKeyDown={keys}
        onBlur={leave}
      >
        <div className="tmt-block-question-mark" aria-hidden="true">
          ?
        </div>
        <div className="tmt-block-question-content">
          <div className="tmt-block-question-eyebrow">
            {recipient ? `✎ Editing · Answers go to ${recipient}` : '✎ Editing'}
          </div>
          <h3>
            <textarea
              ref={titleField}
              className="tmt-block-question-title"
              aria-label="Question"
              placeholder="Write the question"
              rows={1}
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value.replace(/\n/g, ' '))}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                event.preventDefault();
                commitTitle();
                if (kind === 'short') return;
                if (!draft.length) add();
                else setFocusAt(0);
              }}
            />
          </h3>
          {kind !== 'short' ? (
            <fieldset className="tmt-ui-choices" data-layout="inline">
              <legend className="tmt-ui-choices-legend">Choices</legend>
              <div className="tmt-block-question-choices">
                {draft.map((choice, index) => (
                  <div className="tmt-block-question-choice-edit" key={index}>
                    <span className={marker} aria-hidden="true" />
                    <input
                      data-choice-field=""
                      aria-label={`Choice ${index + 1}`}
                      placeholder="Choice"
                      value={choice}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDraft((previous) =>
                          previous.map((item, at) => (at === index ? value : item)),
                        );
                      }}
                      onBlur={(event) => {
                        if (section.current?.contains(event.relatedTarget as Node | null))
                          commitChoices();
                      }}
                      onKeyDown={(event) => choiceKeys(event, index)}
                    />
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      onMouseDown={keepFocus}
                      aria-label={`Remove choice ${index + 1}`}
                      onClick={() => remove(index)}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <div className="tmt-block-question-choice-edit" data-fixed="">
                  <span className={marker} aria-hidden="true" />
                  <span className="tmt-ui-choice-text">Other…</span>
                </div>
                {draft.length < maxChoices && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onMouseDown={keepFocus}
                    onClick={add}
                  >
                    <Plus aria-hidden="true" />
                    Add a choice
                  </Button>
                )}
              </div>
            </fieldset>
          ) : (
            <div className="tmt-block-question-input">
              <Textarea
                aria-label="Answer field"
                placeholder="Write your answer"
                rows={1}
                disabled
              />
            </div>
          )}
          {error && <div role="alert">{error}</div>}
          <div className="tmt-block-question-edit-actions">
            <div className="tmt-block-segments" role="group" aria-label="Answer type">
              {KIND_LABELS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  onMouseDown={keepFocus}
                  onClick={() => kind !== value && onKind(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button type="button" onMouseDown={keepFocus} onClick={done}>
              Done
            </Button>
          </div>
        </div>
      </section>
    </UiTheme>
  );
}
