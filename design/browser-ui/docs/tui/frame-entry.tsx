import '../../generated/static.css';
import { createRoot } from 'react-dom/client';
import { TuiFrame } from './frame.js';
import { oracle } from './model.js';

const query = new URLSearchParams(location.search);
const source = oracle.frames.find(
  (frame) =>
    frame.state === query.get('state') &&
    frame.look === query.get('look') &&
    frame.width === Number(query.get('columns')) &&
    frame.height === Number(query.get('rows')),
);
const from = Number(query.get('from') ?? 0);
const to = Number(query.get('to') ?? source?.height);
const valid =
  source &&
  Number.isSafeInteger(from) &&
  Number.isSafeInteger(to) &&
  from >= 0 &&
  from < to &&
  to <= source.height;
document.documentElement.dataset.theme = source?.look === 'tmt-light' ? 'light' : 'dark';
document.documentElement.dataset.tmtPalette = 'b';
const defaults = oracle.defaults[source?.look === 'tmt-light' ? 'light' : 'dark'];
document.body.style.backgroundColor = defaults.bg;
createRoot(document.getElementById('root')!).render(
  valid ? (
    <TuiFrame frame={source} crop={[from, to]} label={source.state} />
  ) : (
    <p role="alert">No recorded oracle frame for this preview.</p>
  ),
);
