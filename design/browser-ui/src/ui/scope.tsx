import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const PortalContainer = createContext<HTMLElement | null | undefined>(undefined);
export interface ScopeValue {
  root: HTMLElement | null;
  portal: HTMLElement | null;
}
export const Scope = createContext<ScopeValue | undefined>(undefined);

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

/** Render a scoped surface in its owner's portal. */
export const scopePortal = (node: ReactNode, portal: HTMLElement) => createPortal(node, portal);
