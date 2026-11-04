import { useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import {
  PortalContainer,
  Scope,
  findDomScope,
  scopePortal,
  useDsScope,
  type ScopeValue,
} from './scope.js';
export { DsScope, useDsScope } from './scope.js';

export type UiThemeMode = 'light' | 'dark' | 'system';

/** A local variable/utility namespace. Never sets document or body theme. */
export function UiTheme({
  theme = 'system',
  children,
}: {
  theme?: UiThemeMode;
  children: ReactNode;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [domScope, setDomScope] = useState<ScopeValue>();
  const inherited = useDsScope();
  useLayoutEffect(() => {
    if (!node || inherited) return;
    const found = findDomScope(node);
    setDomScope(found);
    // A dynamically inserted page scope may not have its runtime-owned portal yet.
    if (!found?.root || found.portal) return;
    const observer = new MutationObserver(() => {
      const current = findDomScope(node);
      if (current?.portal) {
        setDomScope(current);
        observer.disconnect();
      }
    });
    observer.observe(found.root, { childList: true });
    return () => observer.disconnect();
  }, [node, inherited]);
  const scope = inherited ?? domScope;
  const portal =
    scope && (!scope.portal || !container || !scope.portal.contains(container)) ? null : container;
  return (
    <div data-tmt-ui="" data-tmt-theme={theme} ref={setNode}>
      <Scope.Provider value={scope}>
        <PortalContainer.Provider value={portal}>
          {children}
          {scope ? (
            scope.portal &&
            scopePortal(
              <div
                data-tmt-ui=""
                data-tmt-theme={theme}
                data-tmt-ds-theme-portal=""
                ref={setContainer}
              />,
              scope.portal,
            )
          ) : (
            <div data-tmt-ui-portal="" ref={setContainer} />
          )}
        </PortalContainer.Provider>
      </Scope.Provider>
    </div>
  );
}

/** Pass this to Radix Portal.container; wait for non-null, never fall back to body. */
export function useUiPortalContainer(): HTMLElement | null {
  const container = useContext(PortalContainer);
  if (container === undefined) throw new Error('UI portals require an originating UiTheme');
  return container;
}
