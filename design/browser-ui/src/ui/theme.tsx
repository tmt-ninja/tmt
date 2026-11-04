import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const PortalContainer = createContext<HTMLElement | null | undefined>(undefined);
interface ScopeValue {
  root: HTMLElement | null;
  portal: HTMLElement | null;
}
const Scope = createContext<ScopeValue | undefined>(undefined);

/** One nested design stage owns its local portal and containing element. */
export function DsScope({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return (
    <div data-tmt-ds-scope="" className={className} style={style} ref={setRoot}>
      <Scope.Provider value={{ root, portal }}>
        <PortalContainer.Provider value={portal}>
          {children}
          <div data-tmt-ui-portal="" ref={setPortal} />
        </PortalContainer.Provider>
      </Scope.Provider>
    </div>
  );
}

/** The closest nested stage, or undefined for the product's top-level viewport. */
export function useDsScope(): ScopeValue | undefined {
  return useContext(Scope);
}
/** Custom elements mount separate React roots, so context alone cannot cross their DOM boundary. */
export function findDomScope(node: HTMLElement): ScopeValue | undefined {
  const root = node.parentElement?.closest<HTMLElement>('[data-tmt-ds-scope]');
  return root
    ? { root, portal: root.querySelector<HTMLElement>(':scope > [data-tmt-ui-portal]') }
    : undefined;
}
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
            createPortal(
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
