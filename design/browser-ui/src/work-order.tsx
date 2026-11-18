import { GripVertical } from 'lucide-react';
import type { DragEventHandler } from 'react';

export function WorkDragHandle({
  label,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  onDragStart: DragEventHandler<HTMLSpanElement>;
  onDragEnd?: DragEventHandler<HTMLSpanElement>;
}) {
  return (
    <span
      className="tmt-ui-work-grip"
      draggable
      title={label}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <GripVertical size={16} aria-hidden="true" />
    </span>
  );
}

export function WorkNextLine({ titles }: { titles: readonly string[] }) {
  return (
    <p className="tmt-ui-work-next-line">
      <strong>Next</strong> <span>{titles.length ? titles.join(' → ') : 'No ranked items'}</span>
    </p>
  );
}
