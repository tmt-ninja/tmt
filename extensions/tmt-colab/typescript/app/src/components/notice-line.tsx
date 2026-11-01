import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  UiTheme,
} from '@tmt/browser-ui/ui';
import '@tmt/browser-ui/ui.css';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/**
 * One line of a reserved notice slot (#5911): a longer notice ends in an ellipsis instead of
 * growing the slot. Its whole text stays in the element, so its accessible name is complete, and
 * shows in a tip on hover or keyboard focus, with `more` (a reason's detail) after it.
 */
export function NoticeLine({
  children,
  more,
  className = '',
  ref,
  ...attributes
}: ComponentPropsWithoutRef<'p'> & { more?: ReactNode; ref?: React.Ref<HTMLParagraphElement> }) {
  return (
    <UiTheme>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <p {...attributes} ref={ref} tabIndex={0} className={`notice-line ${className}`}>
              {children}
            </p>
          </TooltipTrigger>
          <TooltipContent className="notice-line-tip">
            {children}
            {more && <span className="notice-line-more"> {more}</span>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </UiTheme>
  );
}
