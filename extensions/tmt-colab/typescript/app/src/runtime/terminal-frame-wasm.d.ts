declare module '*terminal-frame-assets/tmt_tui_wasm.js' {
  export function initSync(input: { module: ArrayBuffer }): unknown;
  export function registry(): string;
  export function render(component: string, props: string, width: number, height: number): string;
}
