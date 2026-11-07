// Runtime 4 supplies the real browser-ui WorkBundle. The host supplies only the admitted display
// metadata for this page id; the tag adds the `tmt-work-change` event for an editable work text.
export default ({ React, data, ui }) => {
  const usePage = data.page;
  return function WorkBundleTag(props) {
    const host = React.useRef(null);
    const [work, setWork] = React.useState(props.work || '');
    React.useEffect(() => setWork(props.work || ''), [props.work]);
    const observed = usePage(props.page || '');
    const page = /^[A-Za-z0-9_-]{1,128}$/.test(props.page || '') ? observed : null;
    let tickets;
    try {
      tickets = JSON.parse(props.tickets || '[]');
    } catch {
      tickets = [];
    }
    tickets = (Array.isArray(tickets) ? tickets : [])
      .slice(0, 20)
      .filter(
        (item) =>
          item &&
          typeof item.label === 'string' &&
          typeof item.href === 'string' &&
          /^https:\/\/github\.com\//.test(item.href),
      );
    const number = Number(props.number);
    return React.createElement(
      'div',
      { ref: host, style: { display: 'contents' } },
      React.createElement(ui.WorkBundle, {
        page: props.page || '',
        number: props.number && Number.isSafeInteger(number) ? number : undefined,
        work,
        tickets,
        data: page || undefined,
        state: page === undefined ? 'loading' : page ? 'ready' : 'unavailable',
        onWorkChange: props.editable
          ? (value) => {
              setWork(value);
              host.current?.dispatchEvent(
                new CustomEvent('tmt-work-change', { bubbles: true, detail: { value } }),
              );
            }
          : undefined,
      }),
    );
  };
};
