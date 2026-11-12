export const scrollBarLicense: Readonly<{
  name: string;
  version: string;
  identifier: string;
  integrity: string;
  commit: string;
  source: string;
  sha256: string;
}>;
export function clarifyBundledLicenses(root: string, entries: unknown): unknown[];
