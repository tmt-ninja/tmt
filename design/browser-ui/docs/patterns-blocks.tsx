import { BlockEditor, type BlockEditorStart } from '../gallery/block-editor.js';
import type { PatternDoc } from './patterns-more.js';

const editor = ({ state }: { state: string }) => <BlockEditor start={state as BlockEditorStart} />;

/** The block editing patterns (#5981), each the gallery's working editor in its opening state. */
export const blockPatterns: PatternDoc[] = [
  {
    slug: 'blocks-document',
    title: 'Blocks as one document',
    lead: 'A page of blocks reads as one document: no border, fill or box between blocks. Hover brings the one shared handle into the gutter, with no tint; only the card draws a frame; callouts, code and tables keep their own fills and rules without another box.',
    states: [
      ['document', 'At rest'],
      ['hover', 'Hover, with the shared handle'],
    ],
    height: 820,
    rules: [
      'One handle per editor, never one per block; it sits 8px left of the block it follows.',
      'Hover and selection are tints; no outline except the keyboard focus ring.',
    ],
    Body: editor,
  },
  {
    slug: 'blocks-insert',
    title: 'Insert a block',
    lead: 'Type / on an empty line, or press the handle’s +: the insert menu lists the block types and filters as you type. ↑↓ choose, Enter inserts and puts the caret in the new block, Esc closes and keeps what was typed. On a phone it is a bottom sheet.',
    states: [
      ['insert', 'Filtered by the typed text'],
      ['insert-empty', 'No match'],
    ],
    height: 620,
    rules: [
      'Focus stays in the editor; the menu names its active item with aria-activedescendant.',
      'A group heading hides while only one group is left.',
    ],
    Body: editor,
  },
  {
    slug: 'blocks-menu',
    title: 'Handle and block menu',
    lead: 'The handle’s grip opens the block menu; so do Menu, Shift+F10 and Cmd/Ctrl+/ from the focused block. Its items are Move to…, Move up, Move down, Duplicate, Copy link to block, @ this block in a comment and Delete, with their keys.',
    states: [['menu', 'Open on the table']],
    height: 820,
    rules: [
      'The block menu never turns a block into another type.',
      'Esc closes it and returns focus to the block.',
    ],
    Body: editor,
  },
  {
    slug: 'blocks-drag',
    title: 'Drag to move',
    lead: 'Drag the grip: the block goes half transparent, a ghost follows the pointer and the drop line shows where it lands. Move up, Move down and Move to… are the keyboard way.',
    states: [['drag', 'Dragging a list item below the table']],
    height: 820,
    rules: [
      'A drop over a card puts the block inside it, one level deep.',
      'A drag never opens the block menu.',
    ],
    Body: editor,
  },
  {
    slug: 'blocks-delete',
    title: 'Delete with Undo',
    lead: 'Delete removes the selected blocks at once and the blocks below move up; the toast names what went and offers Undo, and Cmd/Ctrl+Z restores them in place.',
    states: [['deleted', 'After deleting the table']],
    height: 760,
    rules: [
      'Nothing asks for confirmation; Undo is the safety.',
      'The toast is a status, so it is announced.',
    ],
    Body: editor,
  },
  {
    slug: 'blocks-selection',
    title: 'Keyboard selection',
    lead: 'Esc leaves typing and selects the block; ↑↓ move the selection and Shift+↑↓ extend it; Delete, Cmd/Ctrl+D and Alt+Shift+↑↓ act on every selected block. There is no selection toolbar.',
    states: [['selection', 'Three blocks selected']],
    height: 820,
    rules: [
      'Selected blocks use the selection tint, and their label ends in “selected”.',
      'Esc again clears the selection.',
    ],
    Body: editor,
  },
];
