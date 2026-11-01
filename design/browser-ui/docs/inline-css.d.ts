// A stylesheet imported as text (`?inline`), for the hosted docs' scoped styles (#5866). Colab
// gets the same declaration from vite/client.
declare module '*.css?inline' {
  const css: string;
  export default css;
}
