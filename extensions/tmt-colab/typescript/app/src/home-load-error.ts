import { ManagementError } from './management.js';

/** Only network read failures use the list retry view; typed refusals keep their existing owner. */
export function isOrdinaryListReadFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === 'TimeoutError') ||
    (error instanceof ManagementError && error.code === 'UNAVAILABLE')
  );
}

/** Marks an ordinary failure thrown specifically by the Home transport read. */
export class HomeReadFailure extends Error {
  constructor(cause: unknown) {
    super('Could not load pages', { cause });
  }
}
