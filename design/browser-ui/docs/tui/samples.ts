import { framesFor, type Frame } from './model.js';
import type { Sample } from './catalog.js';

/** Coordinates come from exact text in a particular source row, never a replacement drawing. */
export function resolveSample(
  input: Sample,
  look: string,
): { frame: Frame; from: number; to: number } {
  const candidates = framesFor(input.state, input.look ?? look).filter(
    (frame) =>
      (input.width === undefined || frame.width === input.width) &&
      (input.height === undefined || frame.height === input.height),
  );
  const frame =
    candidates.find((frame) => frame.width === 100 && frame.height === 36) ?? candidates[0];
  if (!frame) throw new Error(`Missing real oracle frame: ${JSON.stringify(input)} / ${look}`);
  const [from, to] = input.crop ?? [0, frame.height];
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to > frame.height ||
    from >= to
  )
    throw new Error(`Invalid source row range for ${input.state}`);
  return { frame, from, to };
}
