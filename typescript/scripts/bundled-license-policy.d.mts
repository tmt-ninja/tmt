import { runPackedCommand } from './packed-command.mjs';

export function acceptedLicenses(root: string, runner?: typeof runPackedCommand): Set<string>;
export function assertBundledLicenses(entries: unknown, accepted: ReadonlySet<string>): number;
export function verifyBundledLicenses(root: string, metadataFile: string): number;
