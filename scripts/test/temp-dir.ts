/**
 * Temporary folders by their real path. On a Windows runner `TEMP` comes in its 8.3 short form
 * (`C:\Users\RUNNER~1\...`) and the daemon resolves paths with `realpathSync.native`, which
 * expands it; `realpathSync` (the JS one) does not. Tests that compare paths need the same form.
 */
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function realTempDir(prefix: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

/** The home the tests run under (the home guard's), as the environment gives it. */
export function testHome(): string {
  return (process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME) ?? "";
}
