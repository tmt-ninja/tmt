import { useCallback, useMemo } from 'react';
import type { BlockOp } from './block-model.js';
import { blockRecords } from './block-projection.js';
import type { BlockEntry } from './blocks.js';
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
  seq,
  binding,
}: {
  blocks: Readonly<Record<string, BlockEntry>>;
  /** The view's local order (`PageView.seq`). */
  seq?: number;
  binding?: PageBinding;
}) {
  const records = useMemo(() => blockRecords(blocks).records, [blocks]);
  const write = useMemo(() => binding?.blocks?.bind(binding), [binding]);
  const send = useCallback(
    async (ops: BlockOp[]) => {
      if (!write) throw new Error('Page editing unavailable');
      return (await write(ops)).seq;
    },
    [write],
  );
  const { tree, editing, focus, typed, key, menu, pick, hover, closeMenu } = useBlockEditing(
    records,
    send,
    seq,
  );
  return (
    <StructuredPage
      tree={tree}
      editing={editing}
      onFocus={focus}
      onTyped={typed}
      onKey={key}
      menu={menu}
      onPick={(entry) => void pick(entry)}
      onHover={hover}
      onCloseMenu={closeMenu}
      readonly={!write}
    />
  );
}
