// The page owns answer persistence; the block emits its answer on the originating form.
export default ({ React, html, prefix }) =>
  function QuestionBlock(props) {
    const Button = `${prefix}-button`;
    const id = React.useId();
    const input = React.useRef(null);
    const otherInput = React.useRef(null);
    const [selected, setSelected] = React.useState([]);
    const [other, setOther] = React.useState(false);
    const [value, setValue] = React.useState('');
    const [expanded, setExpanded] = React.useState(false);
    let choices;
    try {
      choices = JSON.parse(props.choices || '[]');
    } catch {
      choices = [];
    }
    choices = (Array.isArray(choices) ? choices : [])
      .filter((choice) => typeof choice === 'string')
      .slice(0, 20);
    const kind = props.kind || 'single';
    React.useEffect(() => {
      if (other) input.current?.focus();
    }, [other]);
    if (props.state === 'dismissed')
      return html`<div className="tmt-block-question-dismissed">Question removed</div>`;
    if (props.state === 'answered' && !expanded)
      return html`<button
        type="button"
        className="tmt-block-question-answered"
        aria-expanded="false"
        onClick=${() => setExpanded(true)}
      >
        ✓ ${props.label} ${props.answer}
      </button>`;
    const valid =
      kind === 'short'
        ? !!value.trim()
        : (selected.length > 0 || other) && (!other || !!value.trim());
    const choose = (choice, checked) => {
      if (kind === 'single') {
        setSelected([choice]);
        setOther(false);
        setValue('');
      } else
        setSelected((old) => (checked ? [...old, choice] : old.filter((item) => item !== choice)));
    };
    const submit = (event) => {
      event.preventDefault();
      if (!valid) return;
      event.currentTarget.dispatchEvent(
        new CustomEvent('tmt-question-answer', {
          bubbles: true,
          detail: {
            choices: selected,
            ...(other ? { other: value.trim() } : {}),
            ...(kind === 'short' ? { text: value.trim() } : {}),
          },
        }),
      );
    };
    const key = (event) => {
      if (event.nativeEvent.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        submit(event);
        return;
      }
      if (event.key === 'Escape' && other) {
        event.preventDefault();
        setOther(false);
        setValue('');
        otherInput.current?.focus();
        return;
      }
      if (
        kind === 'short' ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.target.tagName === 'TEXTAREA' ||
        !/^[1-9]$/.test(event.key)
      )
        return;
      const at = Number(event.key) - 1;
      if (at === choices.length) {
        event.preventDefault();
        setOther(true);
        if (kind === 'single') setSelected([]);
      } else if (choices[at] !== undefined) {
        event.preventDefault();
        choose(choices[at], !selected.includes(choices[at]));
      }
    };
    return html`<form
      className="tmt-block-question"
      aria-label=${props.label || 'Question'}
      onSubmit=${submit}
      onKeyDown=${key}
    >
      <div className="tmt-block-question-mark" aria-hidden="true">?</div>
      <div className="tmt-block-question-content">
        ${
          props.state === 'answered' &&
          html`<button
            type="button"
            className="tmt-block-question-answered"
            aria-expanded="true"
            onClick=${() => setExpanded(false)}
          >
            ✓ ${props.label} ${props.answer}
          </button>`
        }
        <div className="tmt-block-question-eyebrow">
          ◆ Waiting for your answer · ${props.agent || ''}
        </div>
        <h3>${props.label}</h3>
        ${
          kind !== 'short' &&
          html`<fieldset className="tmt-ui-choices">
            <legend className="tmt-ui-choices-legend">Choices</legend>
            <div className="tmt-block-question-choices">
              ${choices.map(
                (choice, at) => html`<label className="tmt-ui-choice" key=${at}>
                  <input
                    type=${kind === 'multiple' ? 'checkbox' : 'radio'}
                    className=${kind === 'multiple' ? 'tmt-ui-checkbox' : 'tmt-ui-radio'}
                    name=${id}
                    checked=${selected.includes(choice)}
                    aria-label=${choice}
                    aria-keyshortcuts=${at < 9 ? String(at + 1) : undefined}
                    onChange=${(event) => choose(choice, event.target.checked)}
                  />
                  <span className="tmt-ui-choice-text">${choice}</span
                  >${at < 9 && html`<kbd aria-hidden="true">${at + 1}</kbd>`}</label
                >`,
              )}
              <label className="tmt-ui-choice"
                ><input
                  ref=${otherInput}
                  type=${kind === 'multiple' ? 'checkbox' : 'radio'}
                  className=${kind === 'multiple' ? 'tmt-ui-checkbox' : 'tmt-ui-radio'}
                  name=${id}
                  checked=${other}
                  aria-label="Other…"
                  aria-keyshortcuts=${choices.length < 9 ? String(choices.length + 1) : undefined}
                  onChange=${(event) => {
                    setOther(event.target.checked);
                    if (kind === 'single') setSelected([]);
                    if (!event.target.checked) setValue('');
                  }}
                /><span className="tmt-ui-choice-text">Other…</span
                >${choices.length < 9 && html`<kbd aria-hidden="true">${choices.length + 1}</kbd>`}</label
              >
            </div>
          </fieldset>`
        }
        ${
          (kind === 'short' || other) &&
          html`<div className="tmt-block-question-input">
            <textarea
              ref=${input}
              aria-label=${kind === 'short' ? 'Your answer' : 'Other: your answer'}
              aria-describedby=${`${id}-count`}
              placeholder="Write your answer"
              value=${value}
              onInput=${(event) => {
                const next = Array.from(event.target.value).slice(0, 200).join('');
                setValue(next);
                if (kind !== 'short' && !next && value) {
                  setOther(false);
                  otherInput.current?.focus();
                }
              }}
              rows="1"
            />
            <span id=${`${id}-count`}
              >${Array.from(value).length >= 160 ? `${Array.from(value).length} / 200` : ''}</span
            >
          </div>`
        }
        <${Button} disabled=${!valid} onClick=${submit}>Send<//>
      </div>
    </form>`;
  };
