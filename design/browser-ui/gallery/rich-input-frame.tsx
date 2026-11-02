import { useState } from 'react';
import { Paperclip, Search, SendHorizontal } from 'lucide-react';
import { RichInput, emptyRichInputValue, type RichInputValue } from '../src/rich-input/index.js';
import { Button, UiTheme } from '../src/ui/index.js';

const projects = ['design', 'spec', 'release-0.9', 'remote-launch'];
const people = ['sample-lead', 'sample-1', 'sample-2'];
const match = (names: string[], prefix: string) => (query: string) =>
  names.filter((name) => name.startsWith(query)).map((name) => ({ text: `${prefix}${name}` }));

/** Both rich input shapes (#5821 A4), with the submitted values shown for the e2e. */
export function RichInputFrame({ params }: { params: URLSearchParams }) {
  const [search, setSearch] = useState<RichInputValue>(emptyRichInputValue);
  const [message, setMessage] = useState<RichInputValue>(emptyRichInputValue);
  const [sent, setSent] = useState<RichInputValue[]>([]);
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  return (
    <UiTheme theme={theme}>
      <main style={{ display: 'grid', gap: 24, maxWidth: 560, padding: 24 }}>
        <section aria-label="Search">
          <RichInput
            shape="single"
            label="Search pages"
            placeholder="Search pages, or type project:"
            value={search}
            onChange={setSearch}
            onSubmit={(value) => setSent((list) => [...list, value])}
            leading={<Search aria-hidden="true" />}
            suggestions={[
              { kind: 'project', trigger: 'project:', options: match(projects, 'project:') },
            ]}
            removeLabel={(_, text) => `Remove filter ${text}`}
          />
          <output data-search={JSON.stringify(search)} />
        </section>
        <section aria-label="Composer">
          <RichInput
            shape="multi"
            label="Message"
            placeholder="Message, @ to mention"
            value={message}
            onChange={setMessage}
            onSubmit={(value) => {
              setSent((list) => [...list, value]);
              setMessage(emptyRichInputValue);
            }}
            suggestions={[{ kind: 'mention', trigger: '@', options: match(people, '@') }]}
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
          <output data-message={JSON.stringify(message)} />
        </section>
        <output data-sent={JSON.stringify(sent)} />
      </main>
    </UiTheme>
  );
}
