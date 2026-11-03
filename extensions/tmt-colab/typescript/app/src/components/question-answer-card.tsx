import { browserUiClasses as c } from '@tmt/browser-ui/static';
import type { ReactNode } from 'react';

/** The surface shared by the in-page waiting and answered question states. */
export function QuestionAnswerCard({
  label,
  children,
  multiple = false,
}: {
  label: string;
  children: ReactNode;
  multiple?: boolean;
}) {
  return (
    <div
      className={`${c.card} question-compact-block`}
      data-flush
      data-multiple={multiple || undefined}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}
