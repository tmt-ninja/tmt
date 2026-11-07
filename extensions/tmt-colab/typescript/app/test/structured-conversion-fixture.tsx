import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StructuredConversionDialog } from '../src/structured-conversion-dialog.js';
import '../src/style.css';

function Fixture() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(0);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open conversion</button>
      <output data-testid="confirm-count">{confirmed}</output>
      {open && (
        <StructuredConversionDialog
          title="Planning"
          busy={busy}
          onCancel={() => setOpen(false)}
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
