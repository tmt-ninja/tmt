import { Bookmark, Plus } from 'lucide-react';
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
            <TabsList variant="line">
              {stages.map(([value, label, count]) => (
                <TabsTrigger key={value} value={value}>
                  {label} <span style={{ opacity: 0.7 }}>{count}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </TabsBar>
        </Tabs>
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
