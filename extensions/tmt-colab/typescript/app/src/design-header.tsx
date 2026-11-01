import type { ReactNode } from 'react';
import { BrowserMenu, BrowserTopBar } from '@tmt/browser-ui/react';

/** Design is a peer module. Its heading is the shell's crumb, `Design / <system>`, whose system
 * opens the DS menu; it never inherits Colab page chrome. */
export function DesignHeader({
  system,
  systems,
  onSelect,
  actions,
}: {
  system: string;
  systems: readonly { id: string; name: string }[];
  onSelect(id: string): void;
  actions?: ReactNode;
}) {
  const current = systems.find((entry) => entry.id === system);
  return (
    <BrowserTopBar
      title={
        <h1 className="design-header-title">
          <span className="tmt-ui-topbar-title-prefix">
            Design{' '}
            <span className="colab-title-divider" aria-hidden="true">
              /
            </span>
          </span>
          <span className="tmt-ui-topbar-title-current">
            <BrowserMenu
              label="Design system"
              valueLabel={current?.name ?? 'Design system'}
              variant="crumb"
              items={systems.map((entry) => ({
                key: entry.id,
                label: entry.name,
                role: 'menuitemradio' as const,
                checked: entry.id === system,
              }))}
              onSelect={(id) => {
                if (id !== system) onSelect(id);
              }}
            />
          </span>
        </h1>
      }
      actions={actions ? <div className="design-header-actions">{actions}</div> : undefined}
    />
  );
}
