import { useState, type ReactNode } from 'react';
import { UiTheme } from '../src/ui/index.js';
import { follow } from './router.js';

/*
 * The docs' page templates (#5821, #5866): one article, snippet, card and component page, used
 * by the GUI docs and by Design for a person's own design system, so every system's docs share
 * one layout. A host outside DesignDocs wraps them in DocsSurface for the scoped docs styles.
 */

export function Article({
  title,
  lead,
  children,
}: {
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="docs-article">
      <h1>{title}</h1>
      <p className="docs-lead">{lead}</p>
      {children}
    </article>
  );
}

export function Snippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-snippet">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export interface DocsCard {
  href: string;
  title: string;
  body: ReactNode;
}
/** A home page's cards. Links follow the docs router unless the host passes its own `onFollow`. */
export function DocsCards({
  cards,
  onFollow = follow,
}: {
  cards: readonly DocsCard[];
  onFollow?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <div className="docs-cards">
      {cards.map((card) => (
        <a key={card.href} className="docs-card" href={card.href} onClick={onFollow}>
          <b>{card.title}</b>
          <span>{card.body}</span>
        </a>
      ))}
    </div>
  );
}

export interface ComponentProp {
  name: string;
  /** The values it takes: an enum's members or a type. */
  values: string;
  default?: string;
  description?: ReactNode;
}
export interface ComponentVariant {
  label: string;
  /** The live example. */
  render: ReactNode;
  /** Its markup or code, shown under it with Copy. */
  code?: string;
}
export interface ComponentTemplateProps {
  title: string;
  lead: ReactNode;
  /** The hero example. */
  preview: ReactNode;
  /** A note on the hero's motion, shown under it. */
  motion?: ReactNode;
  usage: string;
  variants: readonly ComponentVariant[];
  props?: readonly ComponentProp[];
  dos?: readonly (readonly ['do' | 'dont', string])[];
}
/** A component's page: hero, usage, variants and states, props, then do and don't. */
export function ComponentTemplate({
  title,
  lead,
  preview,
  motion,
  usage,
  variants,
  props,
  dos,
}: ComponentTemplateProps) {
  return (
    <Article title={title} lead={lead}>
      <div className="docs-canvas docs-canvas-hero">{preview}</div>
      {motion && (
        <p className="docs-motion-line">
          <b>Motion</b> {motion}
        </p>
      )}
      <h2>Usage</h2>
      <Snippet code={usage} />
      {variants.length > 0 && <h2>Variants and states</h2>}
      {variants.map((variant) => (
        <section key={variant.label} className="docs-variant">
          <h3>{variant.label}</h3>
          <div className="docs-canvas">{variant.render}</div>
          {variant.code && <Snippet code={variant.code} />}
        </section>
      ))}
      {props && props.length > 0 && (
        <>
          <h2>Props</h2>
          <table className="docs-props">
            <thead>
              <tr>
                <th scope="col">Prop</th>
                <th scope="col">Values</th>
                <th scope="col">Default</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
              {props.map((prop) => (
                <tr key={prop.name}>
                  <td>
                    <code>{prop.name}</code>
                  </td>
                  <td>{prop.values}</td>
                  <td>{prop.default !== undefined && <code>{prop.default}</code>}</td>
                  <td>{prop.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {dos && dos.length > 0 && (
        <>
          <h2>Do and don&apos;t</h2>
          <div className="docs-dos">
            {dos.map(([kind, text]) => (
              <div key={text} className="docs-do" data-kind={kind}>
                <b>{kind === 'do' ? 'Do' : 'Don’t'}</b>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </Article>
  );
}

/**
 * The scoped docs styles for content a host draws outside DesignDocs, such as Design's pages for a
 * person's own system: the element the generated docs-embed.css is scoped to, in the given theme.
 */
export function DocsSurface({ theme, children }: { theme: 'light' | 'dark'; children: ReactNode }) {
  return (
    <div className="tmt-design-docs" data-chrome="hosted" data-theme={theme} data-tmt-palette="b">
      <UiTheme theme={theme}>
        <main className="docs-main">{children}</main>
      </UiTheme>
    </div>
  );
}
