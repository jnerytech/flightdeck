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

const FOLDER_KEY = /^host:[^:]+:(.+)$/;

/** The key's folder, slashes forward and no trailing one, or `null` for a remote key. */
function folderOf(key: string): string | null {
  return FOLDER_KEY.exec(key)?.[1] ?? null;
}

const lastPart = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() as string;

/** What a usage row asks History to show: its folder, or its project key, and the day. */
export interface UsageHistoryTarget {
  cwd?: string;
  projectKey?: string;
  day: string;
}

/** The short name of a project key: the folder's name, or the last part of a remote. */
export function projectLabel(key: string): string {
  return lastPart(folderOf(key) ?? key);
}

/** The folder a `host:<id>:<folder>` key stands for; `null` for a remote key. */
export function projectCwd(key: string): string | null {
  const folder = folderOf(key);
  return folder === null ? null : folder.replace(/[\\/]+$/, "");
}

const HIDDEN_FOLDERS = ["/temp/", "/tmp/", "/var/folders/", "/.claude/worktrees/"];

/** Keys of temp folders and agent worktrees: never a project a person works in. */
export function hiddenProject(key: string): boolean {
  const folder = folderOf(key);
  if (folder === null) return false;
  const path = `/${folder.toLowerCase().replaceAll("\\", "/")}/`;
  return HIDDEN_FOLDERS.some((part) => path.includes(part));
}

/** The visible rows grouped by project (biggest cost first), days newest first. */
export function groupByProject<R extends UsageRow>(rows: R[]): UsageGroup<R>[] {
  const groups = new Map<string, UsageGroup<R>>();
  for (const row of rows) {
    if (hiddenProject(row.projectKey)) continue;
    let group = groups.get(row.projectKey);
    if (!group) {
      group = {
        projectKey: row.projectKey,
        label: projectLabel(row.projectKey),
        cwd: projectCwd(row.projectKey),
        costUsd: 0,
        rows: [],
      };
      groups.set(row.projectKey, group);
    }
    group.costUsd += row.costUsd;
    group.rows.push(row);
  }
  for (const group of groups.values()) group.rows.sort((a, b) => b.day.localeCompare(a.day));
  return [...groups.values()].sort((a, b) => b.costUsd - a.costUsd);
}
