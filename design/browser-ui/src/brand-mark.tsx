import { brandMarkInner } from './brand-mark-svg.js';

/** Ben's selected ninja on its dark tile, generated from the canonical blog artwork (#5971). */
export interface BrandMarkProps {
  /** Rendered square size in px; the canonical silhouette is unchanged at every size. */
  size?: number;
  className?: string;
}

export function BrandMark({ size, className }: BrandMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className ? `tmt-brand-mark ${className}` : 'tmt-brand-mark'}
      viewBox="0 0 96 96"
      aria-hidden="true"
      width={size}
      height={size}
      // Trusted constant markup from the mark's single definition, never user input.
      dangerouslySetInnerHTML={{ __html: brandMarkInner() }}
    />
  );
}

/** Bold lowercase `tmt` with `terminal team` beneath, beside the mark. */
export function BrandLockup({ size = 48 }: { size?: number }) {
  return (
    <span className="tmt-brand-lockup" style={{ ['--tmt-brand-size' as string]: `${size}px` }}>
      <BrandMark size={size} />
      <span className="tmt-brand-lockup-words">
        <span className="tmt-brand-lockup-name">tmt</span>
        <span className="tmt-brand-lockup-tag">terminal team</span>
      </span>
    </span>
  );
}
