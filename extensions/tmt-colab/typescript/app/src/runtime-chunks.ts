import vector from '../../../contracts/vectors/page-runtime-chunks-v1.json';

/** One entry of the page runtime's chunk vector (#6085). */
interface RuntimeChunk {
  readonly name: string;
  readonly after: readonly string[];
  readonly ui: readonly string[];
  readonly parts: readonly string[];
  readonly reserved?: boolean;
}
const chunks = (vector as { chunks: readonly RuntimeChunk[] }).chunks.filter(
  (chunk) => !chunk.reserved,
);
const providerOf = new Map<string, string>();
for (const chunk of chunks) {
  for (const name of chunk.ui) providerOf.set(`ui:${name}`, chunk.name);
  for (const name of chunk.parts) providerOf.set(`part:${name}`, chunk.name);
}

/** What a design-system component declares that decides its chunks. */
export interface ChunkDemand {
  readonly tag: string;
  readonly uiParts?: readonly string[];
  readonly parts?: readonly string[];
  readonly requires?: readonly string[];
}

/**
 * The chunks a page loads, in load order: the base, plus the chunks providing what the verified
 * bundle's components declare, for the components the page writes (and those they require), plus
 * every chunk those come after. Page markup alone never adds a chunk: a tag counts only when the
 * verified bundle has that component.
 */
export function runtimeChunkNames(
  components: readonly ChunkDemand[],
  prefix: string,
  tags: ReadonlySet<string>,
): string[] {
  const byTag = new Map(components.map((component) => [component.tag, component]));
  const used = new Set<ChunkDemand>();
  const visit = (tag: string) => {
    const component = byTag.get(tag);
    if (!component || used.has(component)) return;
    used.add(component);
    for (const name of component.requires ?? []) visit(`${prefix}-${name}`);
  };
  for (const tag of tags) visit(tag);
  const wanted = new Set(['base']);
  for (const component of used) {
    for (const name of component.uiParts ?? []) {
      const chunk = providerOf.get(`ui:${name}`);
      if (chunk) wanted.add(chunk);
    }
    for (const name of component.parts ?? []) {
      const chunk = providerOf.get(`part:${name}`);
      if (chunk) wanted.add(chunk);
    }
  }
  const byName = new Map(chunks.map((chunk) => [chunk.name, chunk]));
  const close = (name: string) => {
    for (const before of byName.get(name)?.after ?? [])
      if (!wanted.has(before)) {
        wanted.add(before);
        close(before);
      }
  };
  for (const name of wanted) close(name);
  return chunks.map((chunk) => chunk.name).filter((name) => wanted.has(name));
}
