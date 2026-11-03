/** One day of one project in a host's usage table. */
export interface UsageRow {
  day: string;
  projectKey: string;
  costUsd: number;
}

export interface UsageGroup<R extends UsageRow> {
  projectKey: string;
  label: string;
  /** The project's folder when its key is a folder key; remote keys have none. */
  cwd: string | null;
  costUsd: number;
  rows: R[];
}

/** The short name of a project key: the folder's name, or the last part of a remote. */
export function projectLabel(_key: string): string {
  return "";
}

/** The folder a `host:<id>:<folder>` key stands for; `null` for a remote key. */
export function projectCwd(_key: string): string | null {
  return "";
}

/** Keys of temp folders and agent worktrees: never a project a person works in. */
export function hiddenProject(_key: string): boolean {
  return false;
}

/** The visible rows grouped by project (biggest cost first), days newest first. */
export function groupByProject<R extends UsageRow>(_rows: R[]): UsageGroup<R>[] {
  return [];
}
