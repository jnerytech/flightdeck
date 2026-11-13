import type { MutationDomain } from "./report.ts";

/** Every file whose change can change a mutant's verdict: the sources it mutates and the tests that judge it. */
export function keyFiles(_domains: MutationDomain[]): string[] {
  return [];
}

/** A digest of the named files' paths and contents: the incremental cache's key (#2485). */
export function cacheKey(_files: string[], _read: (path: string) => string): string {
  return "";
}
