import { ArrowDownUp, Funnel, Plus, Search } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { PageListControls, PageListTabs } from '@tmt/browser-ui/data-table';
import { RichInput, emptyRichInputValue } from '@tmt/browser-ui/rich-input';
import { countText } from '@tmt/browser-ui/static';
import { Button, UiTheme } from '@tmt/browser-ui/ui';
import { text } from './strings.js';
import { NewPageDialog } from './new-page-dialog.js';

/** The list's structure before the first read supplies pages, counts or commands. */
export function ColdPageList({
  theme,
  children,
}: {
  theme: 'light' | 'dark';
  children: ReactNode;
}) {
  const t = text.pageList;
  const [creating, setCreating] = useState(false);
  const create = useRef<HTMLButtonElement>(null);
  return (
    <UiTheme theme={theme}>
      <PageListTabs
        label="Page views"
        value="all"
        disabled
        onChange={() => {}}
        formatCount={countText}
        actions={
          <Button
            ref={create}
            type="button"
            collapseLabel={t.newPage}
            onClick={(event) => {
              if (event.nativeEvent.isTrusted) setCreating(true);
            }}
          >
            <Plus aria-hidden="true" />
          </Button>
        }
        views={[
          { id: 'all', label: t.tabAll },
          { id: 'needs', label: t.tabNeedsYou },
          { id: 'discussion', label: t.tabDiscussion },
          { id: 'in-progress', label: t.tabInProgress },
          { id: 'done', label: t.tabDone },
          { id: 'archived', label: t.tabArchived },
        ]}
      >
        <PageListControls
          className="page-list-controls"
          search={
            <RichInput
              shape="single"
              role="combobox"
              label={t.searchLabel}
              placeholder="Search pages, or type project:"
              value={emptyRichInputValue}
              onChange={() => {}}
              disabled
              leading={<Search aria-hidden="true" />}
            />
          }
          filter={
            <Button type="button" variant="outline" disabled aria-label={text.shortcuts.filter}>
              <Funnel aria-hidden="true" />
              <span className="cold-list-action-label">{text.shortcuts.filter}</span>
            </Button>
          }
          sort={
            <Button type="button" variant="outline" disabled aria-label={t.sort}>
              <ArrowDownUp aria-hidden="true" />
              <span className="cold-list-action-label">{t.sort}</span>
            </Button>
          }
        />
        {children}
      </PageListTabs>
      <NewPageDialog
        open={creating}
        onClose={() => setCreating(false)}
        focusFallback={() => create.current}
      />
    </UiTheme>
  );
}
