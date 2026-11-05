import { createRoot } from 'react-dom/client';
import { usePageAttachmentDownload } from '../src/page-attachment-download.js';
import type { AttachmentBinding } from '../src/attachment-service.js';
import type { attachment } from '@tmt/colab-client';

export function mountDownloadFixture() {
  const state = window as unknown as { reads: number; failDownload: boolean };
  state.reads = 0;
  state.failDownload = false;
  const descriptor = {
    attachmentId: '11111111-1111-4111-8111-111111111111',
    filename: 'example.png',
    mediaType: 'image/png',
    plaintextBytes: '1',
  } as attachment.AttachmentDescriptor;
  const binding = {
    scope: () => 'current',
    open: async () => {
      state.reads += 1;
      if (state.failDownload) throw new Error('offline');
      return new Uint8Array([1]);
    },
  } as unknown as AttachmentBinding;
  function Fixture() {
    const download = usePageAttachmentDownload(binding, [descriptor], () => 0);
    return (
      <>
        <button onClick={() => download.request(descriptor.attachmentId)}>Request</button>
        <button onClick={() => download.request('unknown')}>Unknown</button>
        <button onClick={download.reset}>New render</button>
        {download.bar}
      </>
    );
  }
  const host = document.createElement('div');
  document.body.prepend(host);
  createRoot(host).render(<Fixture />);
}
