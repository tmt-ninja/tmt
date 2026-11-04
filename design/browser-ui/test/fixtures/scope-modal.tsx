import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserDialog } from '../../src/dialog.js';
import { BrowserMenu } from '../../src/menu.js';
import { BrowserChips } from '../../src/chips.js';
import { BrowserNotifications } from '../../src/notifications.js';
import { DsScope, UiTheme } from '../../src/ui/theme.js';
import { TopBarFrame } from '../../gallery/topbar-frame.js';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../../src/ui/sheet.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../src/ui/dialog.js';

function Fixture() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [notifying, setNotifying] = useState(false);
  const events = useMemo(
    () =>
      notifying
        ? [
            {
              id: 'scope-notice',
              destination: 'Chat' as const,
              firstLine: 'A scoped reply',
              onActivate: () => {},
            },
          ]
        : [],
    [notifying],
  );
  const [outside, setOutside] = useState(0);
  const [other, setOther] = useState(0);
  const [showNativeShell, setShowNativeShell] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOutside((n) => n + 1)}>
        Outside {outside}
      </button>
      <DsScope
        style={{
          width: 320,
          height: 280,
          overflow: 'auto',
        }}
      >
        <button type="button">Inside action</button>
        <button type="button" onClick={() => setOpen(true)}>
          Open dialog
        </button>
        <BrowserMenu
          label="Scoped menu"
          triggerText="Menu"
          items={[{ key: 'one', label: 'One' }]}
          onSelect={() => {}}
        />
        <BrowserChips
          label="Scoped recipients"
          items={[]}
          options={[{ id: 'one', label: 'One' }]}
          query={query}
          onQueryChange={setQuery}
          onAdd={() => {}}
          onRemove={() => {}}
          addLabel="Add scoped recipient"
          searchLabel="Search scoped recipients"
          emptyText="No recipients"
        />
        <button type="button" onClick={() => setNotifying(true)}>
          Show notification
        </button>
        <BrowserNotifications
          pageKey="scope"
          events={events}
          suspended={false}
          isEligible={() => true}
        />
        <button type="button" inert>
          Already inert
        </button>
        <UiTheme theme="dark">
          <Dialog>
            <DialogTrigger>Open UI dialog</DialogTrigger>
            <DialogContent>
              <DialogTitle>Scoped UI dialog</DialogTitle>
              <DialogDescription>A local dialog</DialogDescription>
              <button type="button">UI action</button>
              <Dialog>
                <DialogTrigger>Open nested dialog</DialogTrigger>
                <DialogContent>
                  <DialogTitle>Nested dialog</DialogTitle>
                  <DialogDescription>A nested local dialog</DialogDescription>
                  <button type="button">Nested action</button>
                </DialogContent>
              </Dialog>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger>Open UI sheet</SheetTrigger>
            <SheetContent>
              <SheetTitle>Scoped UI sheet</SheetTitle>
              <SheetDescription>A local sheet</SheetDescription>
              <button type="button">Sheet action</button>
            </SheetContent>
          </Sheet>
        </UiTheme>
        <BrowserDialog open={open} title="Scoped dialog" onDismiss={() => setOpen(false)}>
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </BrowserDialog>
      </DsScope>
      <button
        type="button"
        onClick={() => {
          const portal = document.createElement('div');
          portal.setAttribute('data-tmt-ui-portal', '');
          document.getElementById('late-scope')!.append(portal);
        }}
      >
        Install late portal
      </button>
      <div id="late-scope" data-tmt-ds-scope="" style={{ width: 320, height: 180 }}>
        <UiTheme>
          <Dialog>
            <DialogTrigger>Open late dialog</DialogTrigger>
            <DialogContent>
              <DialogTitle>Late dialog</DialogTitle>
              <DialogDescription>Late portal</DialogDescription>
            </DialogContent>
          </Dialog>
        </UiTheme>
      </div>
      <button type="button" onClick={() => setShowNativeShell(false)}>
        Unmount native shell
      </button>
      <DsScope style={{ width: 800, height: 400 }}>
        {showNativeShell && <TopBarFrame params={new URLSearchParams({ renderer: 'native' })} />}
      </DsScope>
      <DsScope style={{ width: 800, height: 400 }}>
        <TopBarFrame params={new URLSearchParams({ renderer: 'react' })} />
      </DsScope>
      <DsScope style={{ height: 100, overflow: 'scroll' }}>
        <button type="button" onClick={() => setOther((n) => n + 1)}>
          Other scope {other}
        </button>
      </DsScope>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
