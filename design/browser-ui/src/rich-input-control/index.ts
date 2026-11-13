// The rich input's field surface (#5830): hosts render it inside RichInputCore. It is its own entry
// so the page runtime's RichInput never reaches the Browser field parts it renders.
export { RichInputControl } from './control.js';
export type { RichInputControlProps } from './control.js';
