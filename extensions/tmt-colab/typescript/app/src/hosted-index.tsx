import { createRoot } from 'react-dom/client';
import { startConnectGuide } from './connect-guide.js';
import { startHosted } from './hosted-main.js';
import '@tmt/browser-ui/static.css';
import './style.css';

// The hosted origin never runs the paired app or its Design and preview routes.
document.body.classList.remove('guidance');
const root = createRoot(document.getElementById('root')!);
if (location.pathname === '/pair') {
  const link = location.href;
  history.replaceState(history.state, '', location.pathname + location.search);
  startConnectGuide(root, link);
} else {
  void startHosted(root);
}
