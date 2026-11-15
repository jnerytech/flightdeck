/**
 * Phase 17: what trusting an action covers. The declaration alone is not enough: the agent can edit
 * the files of its worktree, and one new line in `./scripts/deploy.sh` would leak a secret the mask
 * never sees. So trust pins the sha256 of `run[0]` and of every argument that is an existing file
 * inside a git repository, and the daemon recomputes them right before running.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { inSequence } from "@flightdeck/protocol";
import { canonical, type Fingerprint } from "./domain/fingerprint.ts";
import type { ActionDef } from "./domain/schema.ts";

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Whether some folder above the file holds a `.git`. */
async function insideRepository(file: string): Promise<boolean> {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (await exists(join(dir, ".git"))) return true; // NOSONAR: walks up one folder at a time and stops at the first hit
    if (dirname(dir) === dir) return false;
  }
}

/** The action's fingerprint: its declaration and the files it would execute or read. */
export async function fingerprint(action: ActionDef, base: string): Promise<Fingerprint> {
  const { name: _name, description: _description, ...declared } = action;
  const root = action.cwd ? resolve(base, action.cwd) : base;
  const files: Record<string, string> = {};
  await inSequence(action.run, async (element) => {
    // A placeholder is not a path yet; a flag or a bare program does not exist as a file here.
    if (element.includes("{{")) return;
    const path = resolve(root, element);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || !(await insideRepository(path))) return;
    files[relative(base, path).replaceAll("\\", "/")] = sha(await readFile(path));
  });
  return { declaration: sha(canonical(declared)), files };
}
