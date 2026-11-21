/**
 * Issue #3624: what `flightdeckd file list|read|search|dirs|files` prints. Every name and every line of text comes
 * from the daemon, which read it from a checkout: `said` and `json` clean them for a terminal. A file that may
 * hold a credential is listed by name and never read, and it stays so here.
 */
import type {
  FileListing,
  FileSearchResult,
  FsDirsResult,
  FsFilesResult,
} from "@flightdeck/protocol";

/** What the file runner takes: one verb, its target or host path, and the flags that belong to it. */
export type FileCliArgs =
  | { action: "list"; target: string; dir: string; json?: boolean }
  | { action: "read"; target: string; path: string; json?: boolean }
  | {
      action: "search";
      target: string;
      mode: "name" | "content";
      query: string;
      limit?: number;
      json?: boolean;
    }
  | { action: "dirs"; path?: string; hidden?: boolean; json?: boolean }
  | { action: "files"; path: string; hidden?: boolean; json?: boolean };

export const listJson = (_listing: FileListing) => ({});
export const listLines = (_target: string, _listing: FileListing): string[] => [];

export const readJson = (_file: { path: string; text: string; hash: string; size: number }) => ({});
export const readLines = (_file: {
  path: string;
  text: string;
  hash: string;
  size: number;
}): string[] => [];

export const searchJson = (_result: FileSearchResult) => ({});
export const searchLines = (_result: FileSearchResult): string[] => [];

export const dirsJson = (_listing: FsDirsResult) => ({});
export const dirsLines = (_listing: FsDirsResult): string[] => [];

export const filesJson = (_listing: FsFilesResult) => ({});
export const filesLines = (_listing: FsFilesResult): string[] => [];
