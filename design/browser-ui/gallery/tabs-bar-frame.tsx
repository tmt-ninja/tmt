import { Bookmark, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, Chip, Tabs, TabsBar, TabsList, TabsTrigger, UiTheme } from '../src/ui/index.js';

const stages = [
  ['all', 'All', 38],
  ['needs', 'Needs you', 4],
  ['discussion', 'Discussion', 12],
  ['progress', 'In progress', 9],
  ['done', 'Done', 13],
  ['archived', 'Archived', 6],
] as const;

/** The tabs row with actions (A5a/b) and a chip inside a sized control host (A5c), for the e2e. */
export function TabsBarFrame({ params }: { params: URLSearchParams }) {
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  // Live changes for the e2e: tabs added after mount, and the variant leaving `line`.
  const [extra, setExtra] = useState(0);
  const [line, setLine] = useState(true);
  return (
    <UiTheme theme={theme}>
      <main style={{ display: 'grid', gap: 24, padding: 16 }}>
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
            <TabsList variant={line ? 'line' : 'default'}>
              {stages.map(([value, label, count]) => (
                <TabsTrigger key={value} value={value}>
                  {label} <span style={{ opacity: 0.7 }}>{count}</span>
                </TabsTrigger>
              ))}
              {Array.from({ length: extra }, (_, index) => (
                <TabsTrigger key={index} value={`extra-${index}`}>
                  Saved view {index + 1}
                </TabsTrigger>
              ))}
            </TabsList>
          </TabsBar>
        </Tabs>
        <p style={{ display: 'flex', gap: 8 }}>
          <Button type="button" variant="outline" onClick={() => setExtra(extra + 4)}>
            Add tabs
          </Button>
          <Button type="button" variant="outline" onClick={() => setExtra(0)}>
            Remove added tabs
          </Button>
          <Button type="button" variant="outline" onClick={() => setLine(!line)}>
            Toggle underline
          </Button>
        </p>
        {/* A host that sizes every control in it, as Colab's list controls do (#5857). */}
        <style>{`.sized-host { --tmt-ui-host-action-min-height: 40px; --tmt-ui-host-icon-action-size: 40px; }
.sized-host button { width: 40px; height: 40px; min-height: 40px; padding: 10px; margin: 4px; }`}</style>
        <div className="sized-host" data-testid="sized-host">
          <Chip
            item={{ id: 'design', label: 'project:design', removeLabel: 'Remove project:design' }}
            onRemove={() => {}}
          />
        </div>
      </main>
    </UiTheme>
  );
}
