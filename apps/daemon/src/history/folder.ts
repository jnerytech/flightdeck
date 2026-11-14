import { normalizeCwdFor } from "./domain/folder.ts";

/** Comparable form of a folder on this host: the platform decides whether case is folded. */
export const normalizeCwd = (path: string): string => normalizeCwdFor(path, process.platform);
