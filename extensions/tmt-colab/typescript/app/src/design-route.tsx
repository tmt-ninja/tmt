/** The Design destination hosts the existing design-system library; it owns no content copy. */
import { useContext, useEffect } from 'react';
import { useRouter, useRouterState, useRouteContext } from '@tanstack/react-router';
import { BrowserShell, HostedShell } from '@tmt/browser-ui/react';
import { shellRail, type ShellModule } from '@tmt/browser-ui/shell';
import { ShellHostSlot } from './colab-shell.js';
import { DesignLibrary } from './design-library.js';
import './design-route.css';
import { designBase } from './entry.js';

export function DesignRoute() {
  const slot = useContext(ShellHostSlot);
  const router = useRouter();
  const { transport } = useRouteContext({ from: '__root__' });
  const route = useRouterState({
    select: (state) => `${state.location.pathname}${state.location.searchStr}`,
  });
  const base = designBase();
  const path = `${base}${route.slice('/design'.length)}`;
  const navigate = (href: string) => {
    void router.navigate({ href });
  };
  useEffect(() => {
    if (slot) slot.setTitle('Design');
    else document.title = 'Design · TMT';
  }, [slot]);
  // The router updates location before an outgoing route is unmounted. Do not let the docs'
  // default-route redirect take ownership of a navigation leaving Design.
  if (route !== '/design' && !route.startsWith('/design/') && !route.startsWith('/design?'))
    return null;
  const content = <DesignLibrary transport={transport} path={path} navigate={navigate} />;
  if (slot)
    return (
      <HostedShell slot={slot} menu={undefined}>
        {content}
      </HostedShell>
    );
  const host: ShellModule = {
    extension: 'colab',
    rail: { label: 'Colab', icon: 'file-text', path: `${location.origin}/colab/`, order: 100 },
    menu: [],
    settings: [],
  };
  return (
    <BrowserShell
      view={{
        rail: shellRail(
          undefined,
          { origin: location.origin, href: `${location.origin}${base}/` },
          host,
        ),
      }}
    >
      {content}
    </BrowserShell>
  );
}
