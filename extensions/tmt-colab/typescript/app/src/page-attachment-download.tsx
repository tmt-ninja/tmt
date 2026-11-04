import { BrowserAction } from '@tmt/browser-ui/react';
import type { attachment } from '@tmt/colab-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttachmentBinding } from './attachment-service.js';
import { useAttachmentOpener } from './attachment-opener.js';
import './page-link-bar.css';

/** A frame may ask, but only this parent confirmation grants a current attachment download. */
export function usePageAttachmentDownload(
  binding: AttachmentBinding | undefined,
  descriptors: readonly attachment.AttachmentDescriptor[],
  inset: () => number,
) {
  const opener = useAttachmentOpener(binding, { kind: 'document' }, descriptors);
  const [requested, setRequested] = useState<string>();
  const reset = useCallback(() => setRequested(undefined), []);
  const item = descriptors.find((descriptor) => descriptor.attachmentId === requested);
  const root = useRef<HTMLDivElement>(null);
  const top = useRef(inset);
  top.current = inset;
  useEffect(() => {
    const node = root.current;
    if (!node || !item) return;
    node.style.top = `${Math.max(0, top.current())}px`;
    node.showPopover();
    node.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (node.matches(':popover-open')) node.hidePopover();
    };
  }, [item]);
  return {
    request: (id: string) => setRequested(id),
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
            if (event.newState === 'closed') setRequested(undefined);
          }}
        >
          <h2>Download attachment?</h2>
          <p>{item.filename}</p>
          <BrowserAction
            type="button"
            variant="ghost"
            label="Cancel"
            onActivate={() => setRequested(undefined)}
          />
          <BrowserAction
            type="button"
            variant="primary"
            label="Download"
            onActivate={(event) => {
              if (!event.isTrusted) return;
              void opener.download(item);
              setRequested(undefined);
            }}
          />
        </div>
      ) : null,
  };
}
