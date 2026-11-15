import { isExcludedCwdFor, normalizeCwdFor } from "./domain/folder.ts";

/** Comparable form of a folder on this host: the platform decides whether case is folded. */
export const normalizeCwd = (path: string): string => normalizeCwdFor(path, process.platform);

/** Whether a session's folder is one the user excluded (`excludes` already through `normalizeCwd`), on this host. */
export const isExcludedCwd = (
  cwd: string | null | undefined,
  excludes: readonly string[],
): boolean => isExcludedCwdFor(cwd, excludes, process.platform);
