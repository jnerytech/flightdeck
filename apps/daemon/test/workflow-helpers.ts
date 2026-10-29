import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "./board-helpers.ts";

/** The example workflow of docs/SPEC-fase-6.md. */
export const EXAMPLE = readFileSync(
  join(import.meta.dir, "fixtures/workflows/feature.yaml"),
  "utf8",
);

/** Writes `.flightdeck/workflows/<name>.yaml` in `cwd` and commits it on the current branch. */
export function commitWorkflow(cwd: string, name: string, yaml: string): void {
  const dir = join(cwd, ".flightdeck", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.yaml`), yaml);
  git(cwd, "add", ".flightdeck/workflows");
  git(cwd, "commit", "-q", "-m", `workflow ${name}`);
}

/** sha256 (hex) of a workflow file, as the daemon computes it. */
export const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
