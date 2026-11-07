import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  StructuredConversionDialog,
  StructuredRevertDialog,
} from '../src/structured-conversion-dialog.js';
import { PageHeaderActions } from '../src/page-header-actions.js';
import '@tmt/browser-ui/static.css';
import '@tmt/browser-ui/ui.css';
import '../src/colab-header.css';
import '../src/style.css';

function Fixture() {
  const [open, setOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(0);
  return (
    <>
      <header>
        <h1>Planning</h1>
        <PageHeaderActions
          files={0}
          canExport={false}
          canManage={false}
          canFiles={false}
          canProjects={false}
          access="Private"
          onSelect={() => {}}
          onConvert={() => setOpen(true)}
          onRevert={() => setReverting(true)}
        />
      </header>
      <output data-testid="confirm-count">{confirmed}</output>
      {open && (
        <StructuredConversionDialog
          busy={busy}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setConfirmed((count) => count + 1);
            setBusy(true);
          }}
        />
      )}
      {reverting && (
        <StructuredRevertDialog
          blockCount={12}
          busy={busy}
          onCancel={() => setReverting(false)}
          onConfirm={() => {
            setConfirmed((count) => count + 1);
            setBusy(true);
          }}
        />
      )}
    </>
  );
}

export function render() {
  createRoot(document.getElementById('root')!).render(<Fixture />);
}
