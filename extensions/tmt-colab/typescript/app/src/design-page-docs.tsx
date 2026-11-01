import { useSyncExternalStore } from 'react';
import {
  Article,
  ComponentTemplate,
  DocsCards,
  DocsSurface,
} from '../../../../../design/browser-ui/docs/templates.js';
import '../../../../../design/browser-ui/generated/docs-embed.css';
import { DesignFrame } from './design-frame.js';
import { designPageModel, designExample } from './design-page-model.js';
import { designSystemPin } from './design-system.js';
import { writePin, type DesignSystemEntry } from './design-system-pages.js';
import { designBase } from './entry.js';
import { getTheme, subscribeTheme } from './theme.js';
import type { PageSnapshot, PageTransport, PageView } from './transport.js';

/** Render author data through the same templates as the built-in GUI docs, never source HTML in the parent. */
export function DesignPageDocs({
  transport,
  page,
  system,
  navigate,
}: {
  transport: PageTransport;
  page: PageSnapshot & Pick<PageView, 'attachments'>;
  system: DesignSystemEntry;
  navigate(href: string): void;
}) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme);
  const model = designPageModel(page.source);
  const images = { binding: page.binding?.files?.attachments, descriptors: page.attachments ?? [] };
  if (model.kind === 'page')
    return (
      <DesignFrame
        transport={transport}
        source={page.source}
        title={page.title}
        images={images}
        layout={page.layout}
      />
    );
  if (model.kind === 'home')
    return (
      <DocsSurface theme={theme}>
        <Article
          title={model.config.name}
          lead={model.config.principles?.summary ?? `The ${model.config.name} design system.`}
        >
          <h2>Components</h2>
          <DocsCards
            cards={model.config.components
              .filter((entry) => entry.page)
              .map((entry) => ({
                href: `${designBase()}/systems/${encodeURIComponent(system.id)}/${encodeURIComponent(entry.page!)}`,
                title: `<${model.config.prefix}-${entry.tag}>`,
                body: entry.status ?? 'Component documentation and live examples',
              }))}
            onFollow={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              navigate(event.currentTarget.getAttribute('href')!);
            }}
          />
          {model.config.principles?.rules.length ? (
            <>
              <h2>Principles</h2>
              <ul>
                {model.config.principles.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </>
          ) : null}
        </Article>
      </DocsSurface>
    );
  const { doc } = model;
  const pin = designSystemPin(page.source);
  if (!pin) return <p role="alert">Publish this design system before previewing its components.</p>;
  const meta = writePin('', `${pin.system}@${pin.version}#${pin.hash}`);
  const examples = doc.examples ?? [];
  const lead = doc.notes
    ? [...new DOMParser().parseFromString(doc.notes, 'text/html').body.childNodes]
        .map((node) => node.textContent)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    : `The ${system.config.prefix}-${doc.tag} component.`;
  const frame = (markup: string, title: string) => (
    <DesignFrame
      transport={transport}
      title={title}
      preview
      images={images}
      source={`${meta}<div class="flex min-h-screen items-center justify-center p-4">${designExample(markup, system.config.prefix)}</div>`}
    />
  );
  const usage = `${meta}\n${designExample(examples[0]?.markup ?? `<tmt-ui-${doc.tag}></tmt-ui-${doc.tag}>`, system.config.prefix)}`;
  return (
    <DocsSurface theme={theme}>
      <ComponentTemplate
        title={`<${system.config.prefix}-${doc.tag}>`}
        lead={lead}
        preview={frame(
          examples[0]?.markup ?? `<tmt-ui-${doc.tag}></tmt-ui-${doc.tag}>`,
          'Component preview',
        )}
        usage={usage}
        variants={examples.map((example) => ({
          label: example.title,
          render: frame(example.markup, example.title),
          code: designExample(example.markup, system.config.prefix),
        }))}
        props={Object.entries(doc.props).map(([name, spec]) => ({
          name,
          values: spec.enum?.join(' · ') ?? spec.type ?? '',
          default: spec.default,
        }))}
      />
    </DocsSurface>
  );
}
