import { TuiFrame } from './frame.js';
import { oracle } from './model.js';

/** A TUI oracle frame (docs/tui/frame.html) drawn in the document, cropped as its query says. */
export function TuiFramePreview({ params }: { params: URLSearchParams }) {
  const source = oracle.frames.find(
    (frame) =>
      frame.state === params.get('state') &&
      frame.look === params.get('look') &&
      frame.width === Number(params.get('columns')) &&
      frame.height === Number(params.get('rows')),
  );
  const from = Number(params.get('from') ?? 0);
  const to = Number(params.get('to') ?? source?.height);
  if (!source || !(from >= 0 && from < to && to <= source.height))
    return <p role="alert">No recorded oracle frame for this preview.</p>;
  const defaults = oracle.defaults[source.look === 'tmt-light' ? 'light' : 'dark'];
  return (
    <div style={{ backgroundColor: defaults.bg }}>
      <TuiFrame frame={source} crop={[from, to]} label={source.state} />
    </div>
  );
}
