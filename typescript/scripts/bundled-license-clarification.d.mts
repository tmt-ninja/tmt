export interface LicensePin {
  readonly name: string;
  readonly version: string;
  readonly identifier: string;
  /** The pin supplies `identifier` only while the emitted entry names none. */
  readonly identifierWhenMissing?: boolean;
  readonly integrity: string;
  readonly commit: string;
  readonly source: string;
  readonly sha256: string;
}
export const licensePins: readonly LicensePin[];
export function clarifyBundledLicenses(root: string, entries: unknown): unknown[];
