import { useState, type ReactNode } from 'react';
import {
  Bookmark,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  MessagesSquare,
  MousePointer2,
  Paperclip,
  Plus,
  Search,
  SendHorizontal,
} from 'lucide-react';
import { RichInput, emptyRichInputValue, type RichInputValue } from '../src/rich-input/index.js';
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
  Chip,
  Chips,
  Combobox,
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  FloatingAction,
  FloatingActions,
  FloatingDock,
  FloatingWindow,
  FloatingWindowAction,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Surface,
  Tabs,
  TabsBar,
  TabsList,
  TabsTrigger,
  TooltipProvider,
  useLayerController,
  type SelectionItem,
} from '../src/ui/index.js';
import type { ComponentDoc } from './catalog.js';
// Named for the coverage test and the reader: DialogPortal, DialogOverlay, DropdownMenuPortal.

const row = (...children: ReactNode[]) => <div className="docs-row">{children}</div>;
const importLine = (from: string, ...names: string[]) =>
  `import { ${names.join(', ')} } from '@tmt/browser-ui/${from}';\n\n`;

/**
 * The composition parts each layer entry also exports (#5821 B): the structural pieces the main
 * example does not need, shown live. DialogPortal and DialogOverlay, DropdownMenuPortal and the
 * portals inside Select and Popover are placed by their Content part; a host composes them only for
 * a custom layer, so they are named here and in the usage of their entries.
 */
export const moreVariants: Record<string, [string, () => ReactNode][]> = {
  tabs: [
    [
      'Tabs row with actions (TabsBar)',
      () => (
        <Tabs defaultValue="all">
          <TabsBar
            actions={
              <>
                <Button type="button" variant="outline" collapseLabel="Save as shortcut">
                  <Bookmark aria-hidden="true" />
                </Button>
                <Button type="button" collapseLabel="New page">
                  <Plus aria-hidden="true" />
                </Button>
              </>
            }
          >
            <TabsList variant="line">
              {[
                'All 38',
                'Needs you 4',
                'Discussion 12',
                'In progress 9',
                'Done 13',
                'Archived 6',
              ].map((label) => (
                <TabsTrigger key={label} value={label.split(' ')[0]!.toLowerCase()}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </TabsBar>
        </Tabs>
      ),
    ],
  ],
  button: [
    [
      'Collapsing action (collapseLabel)',
      () =>
        row(
          <Button type="button" variant="outline" collapseLabel="Save as shortcut" key="s">
            <Bookmark aria-hidden="true" />
          </Button>,
          <Button type="button" collapseLabel="New page" key="n">
            <Plus aria-hidden="true" />
          </Button>,
          <span className="docs-muted" key="note">
            Below 760px the label hides and the button turns square; the label stays its name.
          </span>,
        ),
    ],
  ],
  card: [
    [
      'With a header action (CardAction)',
      () => (
        <Card>
          <CardHeader>
            <CardTitle>Release plan</CardTitle>
            <CardDescription>2 of 3 done</CardDescription>
            <CardAction>
              <Button type="button" variant="ghost" size="sm">
                Open
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
      ),
    ],
  ],
  dialog: [
    [
      'Custom layer parts',
      () => (
        <pre className="docs-code">{`<Dialog open={open} onOpenChange={setOpen}>
  <DialogPortal>
    <DialogOverlay />
    {/* a host's own content layer; DialogContent already composes both */}
  </DialogPortal>
</Dialog>`}</pre>
      ),
    ],
  ],
  'dropdown-menu': [
    ['Groups, checkbox and radio items, shortcuts and a submenu', () => <MenuParts />],
  ],
  select: [
    [
      'Groups, labels and separators',
      () => (
        <Select defaultValue="design">
          <SelectTrigger aria-label="Project">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Active</SelectLabel>
              <SelectItem value="design">design</SelectItem>
              <SelectItem value="spec">spec</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Archived</SelectLabel>
              <SelectItem value="blog">blog</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      ),
    ],
  ],
  popover: [
    [
      'Anchored to another element (PopoverAnchor)',
      () => (
        <Popover>
          <div className="docs-row">
            <PopoverAnchor asChild>
              <span className="docs-muted">The popover opens under this text,</span>
            </PopoverAnchor>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                not under its trigger
              </Button>
            </PopoverTrigger>
          </div>
          <PopoverContent>Anchored content.</PopoverContent>
        </Popover>
      ),
    ],
  ],
  command: [['Separators and shortcuts, and the palette (CommandDialog)', () => <CommandParts />]],
};

function MenuParts() {
  const [shown, setShown] = useState(true);
  const [sort, setSort] = useState('updated');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline">
          View <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Columns</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={shown} onCheckedChange={setShown}>
            Show resolved
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
          <DropdownMenuRadioItem value="updated">Recently updated</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="title">Title</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          New page <DropdownMenuShortcut>N</DropdownMenuShortcut>
        </DropdownMenuItem>
        {/* DropdownMenuContent renders in DropdownMenuPortal; a custom menu layer composes it. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>design</DropdownMenuItem>
            <DropdownMenuItem>spec</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandParts() {
  const [open, setOpen] = useState(false);
  const list = (
    <CommandList>
      <CommandGroup heading="Pages">
        <CommandItem>
          Theme B review <CommandShortcut>⌘1</CommandShortcut>
        </CommandItem>
        <CommandItem>Release plan</CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Actions">
        <CommandItem>New page</CommandItem>
      </CommandGroup>
    </CommandList>
  );
  return (
    <div className="docs-stack">
      <Command className="docs-command">
        <CommandInput placeholder="Search" />
        {list}
      </Command>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Open the palette
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search" />
        {list}
      </CommandDialog>
    </div>
  );
}

const people = ['sample-lead', 'sample-1', 'sample-2'];
const projects = ['design', 'spec', 'release-0.9'];

function ChipsDemo() {
  const [items, setItems] = useState<SelectionItem[]>([
    { id: 'sample-1', label: '@sample-1', removeLabel: 'Remove @sample-1' },
  ]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const controller = useLayerController({ open, onOpenChange: setOpen });
  return (
    <Chips
      controller={controller}
      label="Recipients"
      placeholder="Add a member"
      emptyLabel="No member matches"
      query={query}
      onQueryChange={setQuery}
      items={items}
      options={people
        .filter((name) => name.includes(query) && !items.some((item) => item.id === name))
        .map((name) => ({ id: name, label: `@${name}` }))}
      onAdd={(option) =>
        setItems((list) => [
          ...list,
          { id: option.id, label: option.label, removeLabel: `Remove ${option.label}` },
        ])
      }
      onRemove={(item) => setItems((list) => list.filter((entry) => entry.id !== item.id))}
    />
  );
}

function ComboboxDemo() {
  const [value, setValue] = useState<string | null>('design');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const controller = useLayerController({ open, onOpenChange: setOpen });
  return (
    <Combobox
      controller={controller}
      label="Project"
      placeholder="Choose a project"
      emptyLabel="No project matches"
      query={query}
      onQueryChange={setQuery}
      value={value}
      options={projects
        .filter((name) => name.includes(query))
        .map((name) => ({ id: name, label: name }))}
      onSelect={(option) => setValue(option.id)}
    />
  );
}

/** The dock placed inside the canvas instead of the viewport corner, so the page shows it in place. */
function FloatingDemo({ thread }: { thread: boolean }) {
  const [open, setOpen] = useState<'chat' | 'comments' | null>(thread ? 'comments' : null);
  return (
    <TooltipProvider>
      <div className="docs-floating-stage">
        <FloatingDock style={{ position: 'absolute', left: 'auto' }}>
          {open && (
            <FloatingWindow
              key={open}
              open
              label={open === 'chat' ? 'Chat' : 'Discussion'}
              onClose={() => setOpen(null)}
              header={
                open === 'comments' ? (
                  <>
                    <span className="docs-counter">1 / 2</span>
                    <Button type="button" variant="ghost" size="xs">
                      Open <ChevronDown aria-hidden="true" />
                    </Button>
                    <span className="docs-grow" />
                    <FloatingWindowAction label="Previous" icon={<ChevronLeft />} disabled />
                    <FloatingWindowAction label="Next" icon={<ChevronRight />} />
                    <FloatingWindowAction label="Resolve" icon={<Check />} />
                    <FloatingWindowAction label="Resolve all open (2)" icon={<CheckCheck />} />
                  </>
                ) : undefined
              }
            >
              <p className="docs-muted">“Corners are small: 2px on controls, 4px on surfaces.”</p>
              <p>
                <b>sample-lead</b> Agree on 2/4. Counts keep the same radius.
              </p>
            </FloatingWindow>
          )}
          <FloatingActions label="Page actions">
            <FloatingAction label="Select to comment" icon={<MousePointer2 />} />
            <FloatingAction
              label="Chat · Unread"
              icon={<MessageCircle />}
              attention
              expanded={open === 'chat'}
              onClick={() => setOpen(open === 'chat' ? null : 'chat')}
            />
            <FloatingAction
              label="Comments (2)"
              icon={<MessagesSquare />}
              count={2}
              expanded={open === 'comments'}
              onClick={() => setOpen(open === 'comments' ? null : 'comments')}
            />
          </FloatingActions>
        </FloatingDock>
      </div>
    </TooltipProvider>
  );
}

function RichInputDemo({ shape }: { shape: 'single' | 'multi' }) {
  const [value, setValue] = useState<RichInputValue>(emptyRichInputValue);
  return shape === 'single' ? (
    <RichInput
      shape="single"
      label="Search pages"
      placeholder="Search pages, or type project:"
      value={value}
      onChange={setValue}
      leading={<Search aria-hidden="true" />}
      suggestions={[
        {
          kind: 'project',
          trigger: 'project:',
          options: (query) =>
            projects
              .filter((name) => name.startsWith(query))
              .map((name) => ({ text: `project:${name}` })),
        },
      ]}
    />
  ) : (
    <RichInput
      shape="multi"
      label="Message"
      placeholder="Message, @ to mention"
      value={value}
      onChange={setValue}
      onSubmit={() => setValue(emptyRichInputValue)}
      suggestions={[
        {
          kind: 'mention',
          trigger: '@',
          options: (query) =>
            people.filter((name) => name.startsWith(query)).map((name) => ({ text: `@${name}` })),
        },
      ]}
      toolbar={
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Attach file">
          <Paperclip aria-hidden="true" />
        </Button>
      }
      trailing={
        <Button type="button" size="icon-sm" aria-label="Send">
          <SendHorizontal aria-hidden="true" />
        </Button>
      }
    />
  );
}

export const moreComponents: ComponentDoc[] = [
  {
    slug: 'surface',
    name: 'Surface',
    description:
      'A box at one elevation level: paper, sheet, raised, overlay or modal. Each pairs a fill with a hairline edge and one shadow level, since dark themes show shadows weakly.',
    preview: () =>
      row(
        ...(['paper', 'sheet', 'raised', 'overlay', 'modal'] as const).map((level) => (
          <Surface key={level} level={level} className="docs-surface-sample">
            {level}
          </Surface>
        )),
      ),
    usage: `${importLine('ui', 'Surface')}<Surface level="sheet">…</Surface>`,
    variants: [],
  },
  {
    slug: 'chips',
    name: 'Chips and combobox',
    description:
      'Chips holds a set of choices as small pills with a round remove, added from a combobox; Combobox picks one option from a filtered list. Backspace in an empty field removes the last chip. A chip owns its size, so no host control rule grows it.',
    preview: () => <ChipsDemo />,
    usage: `${importLine('ui', 'Chips', 'Chip', 'Combobox', 'useLayerController')}const controller = useLayerController({ open, onOpenChange: setOpen });\n<Chips controller={controller} label="Recipients" items={items} options={options}\n  query={query} onQueryChange={setQuery} onAdd={add} onRemove={remove} emptyLabel="No member matches" />`,
    variants: [
      ['Combobox', () => <ComboboxDemo />],
      [
        'A single chip (Chip)',
        () => (
          <Chip
            item={{ id: 'design', label: 'project:design', removeLabel: 'Remove project:design' }}
            onRemove={() => {}}
          />
        ),
      ],
      [
        'Read-only',
        () => (
          <Chip
            item={{ id: 'lead', label: '@sample-lead', removeLabel: 'Remove @sample-lead' }}
            onRemove={() => {}}
            readOnly
            stateLabel="Owner"
          />
        ),
      ],
    ],
  },
  {
    slug: 'floating',
    name: 'Floating actions and window',
    description:
      'FloatingDock places a page’s floating actions at the bottom end and the one window an action opens above them. FloatingActions is the capsule; FloatingAction an action with its count and attention dot, pressed while its window is open. FloatingWindow sizes to its content up to the space above the actions.',
    preview: () => <FloatingDemo thread />,
    usage: `${importLine('ui', 'FloatingDock', 'FloatingActions', 'FloatingAction', 'FloatingWindow', 'FloatingWindowAction')}<FloatingDock top={headerHeight}>\n  {open && (\n    <FloatingWindow key={open} open label="Discussion" onClose={close} header={<>…<FloatingWindowAction label="Resolve" icon={<Check />} /></>}>\n      …\n    </FloatingWindow>\n  )}\n  <FloatingActions label="Page actions">\n    <FloatingAction label="Comments (2)" icon={<MessagesSquare />} count={2} expanded={open === 'comments'} onClick={toggle} />\n  </FloatingActions>\n</FloatingDock>`,
    variants: [
      ['Closed', () => <FloatingDemo thread={false} />],
      [
        'Keyboard contract',
        () => (
          <ul className="docs-list">
            <li>
              Opening moves focus into the window; Esc or Close closes it through one onClose.
            </li>
            <li>Focus returns to the action that opened it. Key the window by that action.</li>
            <li>
              An open menu, select or tooltip inside takes the first Esc; only the next one closes
              the window.
            </li>
            <li>A composing (IME), repeated or modified Esc never closes it.</li>
            <li>One window at a time; its action reads as pressed (aria-expanded) while open.</li>
          </ul>
        ),
      ],
    ],
  },
  {
    slug: 'rich-input',
    name: 'Rich input',
    description:
      'One Lexical editor in two shapes: the single-line search with filter chips and the multi-line composer with mentions, a toolbar and an attachment slot. It ships in its own entry, so pages without it never load Lexical.',
    preview: () => <RichInputDemo shape="single" />,
    usage: `${importLine('rich-input', 'RichInput', 'emptyRichInputValue')}<RichInput shape="multi" label="Message" value={value} onChange={setValue} onSubmit={send}\n  suggestions={[{ kind: 'mention', trigger: '@', options: (query) => … }]} />`,
    variants: [
      ['Composer', () => <RichInputDemo shape="multi" />],
      [
        'Keyboard contract',
        () => (
          <ul className="docs-list">
            <li>Enter submits; Shift+Enter adds a line in the composer.</li>
            <li>A trigger opens suggestions: arrows move, Enter or Tab inserts the chip.</li>
            <li>Esc closes the suggestion list and stops there, so a window around stays open.</li>
            <li>Backspace after a chip removes it; nothing acts during an IME composition.</li>
            <li>Paste is plain text; on the single line a pasted break becomes a space.</li>
          </ul>
        ),
      ],
    ],
  },
];

/** Badges in a chip row read the same height as a chip. */
export const chipBadge = <Badge variant="outline">spec</Badge>;
