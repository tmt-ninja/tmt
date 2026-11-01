import type { ComponentMap } from './ci-scope.mjs';

export interface RetentionRelease {
  id: number;
  tag_name: string;
  draft: boolean;
  published_at?: string | null;
  body?: string;
  target_commitish?: string;
  assets: { name: string }[];
}
export interface RetentionEntry {
  id: number;
  tag: string;
  product: string;
  published_at: string | null;
}
export interface RetentionPlan {
  schema: 1;
  mode: 'dry-run';
  status: 'planned' | 'advisory' | 'refused';
  reason?: string;
  advisory?: string;
  cut: string | null;
  cutoff: string | null;
  retentionDays: number;
  draftVisibility: 'trusted' | 'public' | null;
  counts: { releases: number; candidates: number; deletions: number; protected: number };
  deletions: RetentionEntry[];
  protected: (RetentionEntry & { reasons: string[] })[];
}
export const RETENTION_DAYS: number;
export function planRetention(input: {
  releases: RetentionRelease[];
  map: ComponentMap;
  cut: string;
  git: (args: string[]) => string;
  cutoff: string;
  draftVisibility: 'trusted' | 'public';
}): RetentionPlan;
export function refusedRetentionPlan(input: {
  cut?: string;
  cutoff?: string;
  draftVisibility?: string;
  reason: string;
}): RetentionPlan;
export function renderRetentionSummary(plan: RetentionPlan): string;
