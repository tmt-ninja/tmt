import type { Plugin } from 'vite-plus';

export function licenseText(entries: unknown): string;
export function bundledLicenseOutput(options: { metadataFile: string; sourceRoot: string }): Plugin;
