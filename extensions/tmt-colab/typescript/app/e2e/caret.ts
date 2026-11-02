import type { Locator } from '@playwright/test';

/**
 * Puts the caret at the end of a rich input, as a reader's click there would, and returns once the
 * editor has taken it. The editor reads the caret in its `selectionchange` listener, added when it
 * mounted, so it has run when this one does. A key pressed before that task would reach the editor
 * first, since input outranks queued tasks on a busy main thread, and edit at the old caret (#5938).
 */
export async function caretAtEnd(input: Locator) {
  await input.evaluate(
    (node) =>
      new Promise<void>((taken) => {
        document.addEventListener('selectionchange', () => taken(), { once: true });
        node.focus();
        document.getSelection()!.selectAllChildren(node);
        document.getSelection()!.collapseToEnd();
      }),
  );
}
