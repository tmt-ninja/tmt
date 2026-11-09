/** The optional terminal renderer, loaded only for verified components that use it. */
import { registerChunk } from '../register.js';
import { TerminalFrame } from '../terminal-frame.js';

registerChunk('terminal-frame-ui', {
  ui: { TerminalFrame },
});
