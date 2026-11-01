import { useRef, useState } from 'react';
import { Check, ChevronDown, MessageCircle, MessagesSquare, MousePointer2 } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  FloatingAction,
  FloatingActions,
  FloatingDock,
  FloatingWindow,
  FloatingWindowAction,
  Textarea,
  TooltipProvider,
  UiTheme,
} from '../src/ui/index.js';

/**
 * The floating dock in use (#5821): two actions that each open one window, a header with a filter
 * menu, and a composer, so the e2e can drive Esc order, focus return and the header geometry.
 * `?lines=n` sets the body length; `?theme=dark` the theme.
 */
export function FloatingFrame({ params }: { params: URLSearchParams }) {
  const [open, setOpen] = useState<'chat' | 'comments' | null>(null);
  const [filter, setFilter] = useState('open');
  const [closes, setCloses] = useState<string[]>([]);
  const chat = useRef<HTMLButtonElement>(null);
  const lines = Number(params.get('lines') ?? 3);
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  return (
    <UiTheme theme={theme}>
      <TooltipProvider>
        <main style={{ minHeight: '100dvh', padding: 16 }}>
          <p data-closes={closes.join(' ')}>Floating dock frame</p>
          <FloatingDock top={56}>
            {open && (
              <FloatingWindow
                key={open}
                id="floating-window"
                open
                label={open === 'chat' ? 'Chat' : 'Discussion'}
                returnFocus={() => chat.current}
                onClose={(reason) => {
                  setCloses((list) => [...list, reason]);
                  setOpen(null);
                }}
                header={
                  open === 'comments' ? (
                    <>
                      <span style={{ padding: '0 4px', fontVariantNumeric: 'tabular-nums' }}>
                        1 / 2
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="xs">
                            {filter === 'open' ? 'Open' : 'All'} <ChevronDown aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuRadioGroup value={filter} onValueChange={setFilter}>
                            <DropdownMenuRadioItem value="open">Open</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <span style={{ flex: 1 }} />
                      <FloatingWindowAction label="Resolve" icon={<Check />} />
                    </>
                  ) : undefined
                }
                footer={<Textarea aria-label="Message" placeholder="Message" />}
              >
                {Array.from({ length: lines }, (_, index) => (
                  <p key={index}>Line {index + 1} of the thread.</p>
                ))}
              </FloatingWindow>
            )}
            <FloatingActions label="Page actions">
              <FloatingAction label="Select to comment" icon={<MousePointer2 />} />
              <FloatingAction
                ref={chat}
                label="Chat · Unread"
                icon={<MessageCircle />}
                attention
                expanded={open === 'chat'}
                controls="floating-window"
                onClick={() => setOpen(open === 'chat' ? null : 'chat')}
              />
              <FloatingAction
                label="Comments (2)"
                icon={<MessagesSquare />}
                count={2}
                expanded={open === 'comments'}
                controls="floating-window"
                onClick={() => setOpen(open === 'comments' ? null : 'comments')}
              />
            </FloatingActions>
          </FloatingDock>
        </main>
      </TooltipProvider>
    </UiTheme>
  );
}
