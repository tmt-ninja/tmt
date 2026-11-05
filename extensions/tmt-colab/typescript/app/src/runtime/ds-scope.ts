/** A page may introduce scopes before or after its design-system components are registered. Each scope
 * owns one portal shared by those components' independently mounted React roots. */
export function installScopePortals(document: Document): () => void {
  const selector = '[data-tmt-ds-scope]';
  const mount = (root: ParentNode) => {
    const scopes = [
      ...(root instanceof Element && root.matches(selector) ? [root] : []),
      ...root.querySelectorAll(selector),
    ];
    for (const scope of scopes) {
      if (scope.querySelector(':scope > [data-tmt-ui-portal]')) continue;
      const portal = document.createElement('div');
      portal.setAttribute('data-tmt-ui-portal', '');
      scope.append(portal);
    }
  };
  mount(document);
  // Custom elements can introduce a stage at any depth after startup, so one child-list
  // observer owns the frame lifetime. It scans only added subtrees, never attributes or text;
  // the returned disposer supports explicit teardown and discarding the frame ends the realm.
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes) if (node instanceof Element) mount(node);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
}
