import { createHash } from "node:crypto";
import type { MutationDomain } from "./report.ts";

/** Every file whose change can change a mutant's verdict: the sources it mutates and the tests that judge it. */
export function keyFiles(domains: MutationDomain[]): string[] {
  const paths = domains.flatMap((domain) => [...domain.mutate, ...domain.tests]);
  return [...new Set(paths)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A digest of the named files' paths and contents: the incremental cache's key (#2485). The command
 * runner reports no per-test coverage, so Stryker cannot tell that a changed test makes an old
 * "survived" verdict stale; a new key starts the run cold instead.
 */
export function cacheKey(files: string[], read: (path: string) => string): string {
  const digest = createHash("sha256");
  for (const path of files) {
    const content = read(path);
    // Length-prefixed, so text moved from one file to the next cannot give the same bytes.
    digest.update(`${path}\0${Buffer.byteLength(content)}\0${content}\0`);
  }
  return digest.digest("hex");
}
