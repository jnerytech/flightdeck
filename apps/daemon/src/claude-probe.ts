import type { Exec } from "./exec.ts";

/**
 * Memoized `<claude> --version` probe for `host.info`. Never throws: any failure reports `null`.
 * Only the daemon with the real runtime creates it, so tests and smokes never run `claude`.
 */
export function claudeVersionProbe(path: string | null, exec: Exec): () => Promise<string | null> {
  let cached: Promise<string | null> | null = null;
  return () => {
    // No path (the SDK uses its bundled CLI): nothing to run, nothing to report.
    if (path === null) return Promise.resolve(null);
    cached ??= exec([path, "--version"]).then(
      ({ code, stdout }) => (code === 0 ? stdout.trim() : null),
      () => null,
    );
    return cached;
  };
}
