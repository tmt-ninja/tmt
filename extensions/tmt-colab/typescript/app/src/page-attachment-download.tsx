import { BrowserAction } from '@tmt/browser-ui/react';
import type { attachment } from '@tmt/colab-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttachmentBinding } from './attachment-service.js';
import { useAttachmentOpener } from './attachment-opener.js';
import { downloadCooldown } from './download-cooldown.js';
import { text } from './strings.js';
import './page-link-bar.css';

/** A frame may ask, but only this parent confirmation grants a current attachment download. */
export function usePageAttachmentDownload(
  binding: AttachmentBinding | undefined,
  descriptors: readonly attachment.AttachmentDescriptor[],
  inset: () => number,
) {
  const opener = useAttachmentOpener(binding, { kind: 'document' }, descriptors);
  const [requested, setRequested] = useState<string>();
  const [settled, setSettled] = useState(false);
  const generation = useRef(0);
  const [cooldown] = useState(downloadCooldown);
  // The request the bar shows, read by the close paths without waiting for a render.
  const active = useRef<string>(undefined);
  const close = useCallback(() => {
    generation.current += 1;
    active.current = undefined;
    setSettled(false);
    setRequested(undefined);
  }, []);
  // A Cancel (the button, Escape or a light dismiss) starts the cool-down (#6094).
  const cancel = useCallback(() => {
    if (active.current !== undefined) cooldown.cancelled();
    close();
  }, [close, cooldown]);
  // A new render or page: nothing pending, and the frame may ask again at once.
  const reset = useCallback(() => {
    cooldown.clear();
    close();
  }, [close, cooldown]);
  const item = descriptors.find((descriptor) => descriptor.attachmentId === requested);
  const activeId = item?.attachmentId;
  const canShow = !!item && !!binding;
  const failure = item ? opener.failed.get(item.attachmentId) : undefined;
  const root = useRef<HTMLDivElement>(null);
  const top = useRef(inset);
  top.current = inset;
  useEffect(() => {
    const node = root.current;
    if (!node || !activeId || !canShow) return;
    node.style.top = `${Math.max(0, top.current())}px`;
    node.showPopover();
    node.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (node.matches(':popover-open')) node.hidePopover();
    };
  }, [activeId, canShow]);
  useEffect(() => {
    if (settled && !failure) close();
  }, [close, failure, settled]);
  return {
    request: (id: string) => {
      if (!cooldown.admits()) return;
      generation.current += 1;
      active.current = id;
      setSettled(false);
      setRequested(id);
    },
    reset,
    bar:
      item && binding ? (
        <div
          ref={root}
          popover="auto"
          role="dialog"
          aria-label="Download attachment"
          className="page-link-bar"
          onToggle={(event) => {
            if (event.newState === 'closed' && active.current !== undefined) cancel();
          }}
        >
          <h2>Download attachment?</h2>
          <p>{item.filename}</p>
          {failure && settled && <p role="alert">{text.attachmentReason[failure]}</p>}
          <BrowserAction type="button" variant="ghost" label="Cancel" onActivate={cancel} />
          <BrowserAction
            type="button"
            variant="primary"
            label="Download"
            disabled={opener.busy === item.attachmentId}
            onActivate={(event) => {
              if (!event.isTrusted) return;
              const current = ++generation.current;
              setSettled(false);
              void opener.download(item).then(() => {
                if (generation.current === current) setSettled(true);
              });
            }}
          />
        </div>
      ) : null,
  };
}
