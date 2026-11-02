import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { siteChrome, type SiteChromeOptions } from "./site-chrome.mjs";
import "./site-chrome.css";

export function SiteHeader({
  config,
  children,
}: {
  config: SiteChromeOptions;
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [controls, setControls] = useState<HTMLElement | null>(null);
  const { header } = siteChrome({ ...config, controls: children !== undefined });
  useLayoutEffect(() => {
    // This host owns the escaped static markup; React owns only the portal controls.
    // Reapplying dangerouslySetInnerHTML during a controls render would detach their slot.
    const element = root.current!;
    element.innerHTML = header;
    setControls(element.querySelector<HTMLElement>("[data-site-chrome-controls]"));
  }, [header]);
  return (
    <>
      <div className="site-chrome-slot" ref={root} />
      {controls && createPortal(children, controls)}
    </>
  );
}
export function SiteFooter({ config }: { config: SiteChromeOptions }) {
  return (
    <div
      className="site-chrome-slot"
      dangerouslySetInnerHTML={{ __html: siteChrome(config).footer }}
    />
  );
}
