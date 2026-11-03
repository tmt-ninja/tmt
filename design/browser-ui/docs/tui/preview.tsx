import { useLayoutEffect, useRef, useState } from 'react';
import { ScaledFrame } from '../../gallery/kit.js';
import { resolveSample, type Sample } from './catalog.js';

/** The shared docs preview owns scaling. The probe measures this renderer's real cell metrics. */
export function TuiPreview({
  sample,
  look,
  label,
}: {
  sample: Sample;
  look: string;
  label: string;
}) {
  const { frame, from, to } = resolveSample(sample, look);
  const probe = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = probe.current!;
    const measure = () => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const horizontal = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const vertical = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const border = parseFloat(style.getPropertyValue('--tmt-ui-rule-width'));
      const width = Math.ceil((box.width - horizontal) * frame.width + horizontal + border * 2);
      const height = Math.ceil((box.height - vertical) * (to - from) + vertical + border * 2);
      setSize((previous) =>
        previous?.width === width && previous.height === height ? previous : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame.width, from, to]);
  const params = new URLSearchParams({
    state: frame.state,
    look: frame.look,
    columns: String(frame.width),
    rows: String(frame.height),
    from: String(from),
    to: String(to),
  });
  const src = `/tui/frame.html?${params}`;
  return (
    <figure
      className="tui-sample"
      data-oracle-state={frame.state}
      data-oracle-width={frame.width}
      data-oracle-height={frame.height}
      data-source-from={from}
      data-source-to={to}
    >
      <figcaption>
        <b>{label}</b>
        <span className="docs-muted">
          {frame.width} × {to - from} cells · {frame.look} · source rows {from + 1}–{to}
        </span>
      </figcaption>
      <div className="tui-preview-cell">
        <span className="tui-metrics" ref={probe} aria-hidden="true">
          0
        </span>
        {size && (
          <ScaledFrame
            title={`${label} · ${frame.state} · ${frame.look}`}
            src={src}
            width={size.width}
            height={size.height}
          />
        )}
      </div>
      <a className="tui-source-link" href={src}>
        Open unscaled oracle frame
      </a>
    </figure>
  );
}
