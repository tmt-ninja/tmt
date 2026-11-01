import type { ReactNode } from 'react';
import { BrowserTopBar } from '@tmt/browser-ui/react';

/** Design is a peer module. Its title and system picker never inherit Colab page chrome. */
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
  return (
    <BrowserTopBar
      title={
        <div className="design-header-title">
          <span>Design</span>
          <select
            aria-label="Design system"
            value={system}
            onChange={(event) => onSelect(event.target.value)}
          >
            {systems.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
      }
      actions={actions}
    />
  );
}
