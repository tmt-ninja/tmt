import { useCallback, useMemo } from 'react';
import type { BlockOp } from './block-model.js';
import { blockRecords } from './block-projection.js';
import { StructuredPage } from './structured-page.js';
import type { PageBinding } from './transport.js';
import { useBlockEditing } from './use-block-editing.js';

/**
 * A structured page (`pageType` `blocks`, #6005) over its live binding: the fold projection's
 * `blocks` root draws through `StructuredPage`, and typing goes out as block batches
 * (`binding.blocks`), which resolve once the page shows the commit. A binding without block
 * writes draws the page read-only.
 */
export function LiveStructuredPage({
  blocks,
  binding,
}: {
  blocks: Readonly<Record<string, unknown>>;
  binding?: PageBinding;
}) {
  const records = useMemo(() => blockRecords(blocks).records, [blocks]);
  const write = useMemo(() => binding?.blocks?.bind(binding), [binding]);
  const send = useCallback(
    async (ops: BlockOp[]) => {
      if (!write) throw new Error('Page editing unavailable');
      await write(ops);
    },
    [write],
  );
  const { tree, editing, focus, typed, key } = useBlockEditing(records, send);
  return (
    <StructuredPage
      tree={tree}
      editing={editing}
      onFocus={focus}
      onTyped={typed}
      onKey={key}
      readonly={!write}
    />
  );
}
