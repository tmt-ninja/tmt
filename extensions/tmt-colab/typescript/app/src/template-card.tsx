import type { ReactNode } from 'react';
import type { TemplateEntry } from './templates.js';
import { text } from './strings.js';
import './template-card.css';

const t = text.templates;

/** A structure sketch drawn from the layout alone: a full-bleed board fills the frame; a column
 * page is a heading, a summary line and two section blocks. Decorative. */
export function TemplateThumbnail({ layout }: { layout: TemplateEntry['layout'] }) {
  return (
    <span className="template-thumb" data-layout={layout} aria-hidden="true">
      {layout === 'full' ? (
        <>
          <span className="template-thumb-bar" />
          <span className="template-thumb-grid">
            <span />
            <span />
            <span />
            <span />
          </span>
        </>
      ) : (
        <>
          <span className="template-thumb-title" />
          <span className="template-thumb-line" />
          <span className="template-thumb-block" />
          <span className="template-thumb-block" />
        </>
      )}
    </span>
  );
}

/** Default (amber), TMT (grey) or the author; the same marks on every template surface. */
export function TemplateBadges({
  template,
  source = true,
}: {
  template: TemplateEntry;
  /** Mark TMT's templates; off where the line under the name already names the source. */
  source?: boolean;
}) {
  return (
    <>
      {template.default && (
        <span className="template-badge" data-kind="default">
          {t.defaultBadge}
        </span>
      )}
      {source && template.source === 'builtIn' && (
        <span className="template-badge" data-kind="tmt">
          {t.tmt}
        </span>
      )}
    </>
  );
}

/** The one line under a template's name: its description, layout and where it comes from. */
export function templateMeta(template: TemplateEntry, withSource = true): string {
  const parts = [template.summary, t.layouts[template.layout] ?? template.layout];
  if (withSource)
    parts.push(
      template.source === 'builtIn' ? t.tmt : template.author ? t.by(template.author) : t.thisSpace,
    );
  return parts.filter(Boolean).join(' · ');
}

/** The Templates page card: thumbnail, name with its badges, the meta line and its actions. */
export function TemplateCard({
  template,
  actions,
}: {
  template: TemplateEntry;
  actions: ReactNode;
}) {
  return (
    <article className="template-card" aria-label={template.name}>
      <TemplateThumbnail layout={template.layout} />
      <div className="template-card-body">
        <h3 className="template-card-name">
          <span>{template.name}</span>
          <TemplateBadges template={template} source={false} />
        </h3>
        <p className="template-card-meta">{templateMeta(template)}</p>
        <div className="template-card-actions">{actions}</div>
      </div>
    </article>
  );
}
