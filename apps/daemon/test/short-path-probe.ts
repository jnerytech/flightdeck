import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { shortPath } from "./short-path.ts";

/** Whether 8.3 names are generated on this volume: the short form of a long path is another path. */
export function has83Names(shorten: (path: string) => string, longPath: string): boolean {
  return shorten(longPath) !== longPath;
}

/** Whether the 8.3 tests can run here: Windows, on a volume that generates 8.3 names (else they skip). */
export function volumeHas83Names(): boolean {
  if (process.platform !== "win32") return false;
  const dir = join(realTempDir("fd-83-probe-"), "executavel-com-nome-bem-longo");
  mkdirSync(dir);
  const file = join(dir, "flightdeckd.exe");
  writeFileSync(file, "");
  return has83Names(shortPath, file);
}
