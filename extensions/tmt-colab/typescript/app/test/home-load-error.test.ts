import { expect, it } from 'vite-plus/test';
import { isOrdinaryListReadFailure } from '../src/home-load-error.js';
import { ManagementError } from '../src/management.js';
import { AdmissionRefusedError, ReopenFailedError } from '../src/registration.js';
import { SessionEndedError } from '../src/ask-remote.js';

it('classifies ordinary network and timeout failures for the list alert', () => {
  expect(isOrdinaryListReadFailure(new ManagementError('UNAVAILABLE'))).toBe(true);
  expect(isOrdinaryListReadFailure(new ManagementError('DENIED'))).toBe(false);
  expect(isOrdinaryListReadFailure(new TypeError('Failed to fetch'))).toBe(true);
  expect(isOrdinaryListReadFailure(new DOMException('Timed out', 'TimeoutError'))).toBe(true);
});

it('keeps admission and session refusals and unrelated errors on the existing root error path', () => {
  expect(isOrdinaryListReadFailure(new AdmissionRefusedError(403, '', 'DENIED'))).toBe(false);
  expect(isOrdinaryListReadFailure(new ReopenFailedError('revoked'))).toBe(false);
  expect(isOrdinaryListReadFailure(new SessionEndedError('REMOTE_SESSION_ENDED'))).toBe(false);
  expect(isOrdinaryListReadFailure(new Error('Unexpected failure'))).toBe(false);
  expect(isOrdinaryListReadFailure(new DOMException('Cancelled', 'AbortError'))).toBe(false);
});
