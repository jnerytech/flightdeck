/**
 * Phase 17: what trusting an action covers. The declaration alone is not enough: the agent can edit
 * the files of its worktree, and one new line in `./scripts/deploy.sh` would leak a secret the mask
 * never sees. So trust pins the sha256 of `run[0]` and of every argument that is an existing file
 * inside a git repository, and the daemon recomputes them right before running.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ActionDef } from "./schema.ts";

export interface Fingerprint {
  /** sha256 of what the action declares (not its name nor its description). */
  declaration: string;
  /** Path (relative to the project, with `/`) → sha256 of the file's content. */
  files: Record<string, string>;
}

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** JSON with the keys sorted, so the same declaration always gives the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Whether some folder above the file holds a `.git`. */
function insideRepository(file: string): boolean {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return true;
    if (dirname(dir) === dir) return false;
  }
}

/** The action's fingerprint: its declaration and the files it would execute or read. */
export function fingerprint(action: ActionDef, base: string): Fingerprint {
  const { name: _name, description: _description, ...declared } = action;
  const root = action.cwd ? resolve(base, action.cwd) : base;
  const files: Record<string, string> = {};
  for (const element of action.run) {
    // A placeholder is not a path yet; a flag or a bare program does not exist as a file here.
    if (element.includes("{{")) continue;
    const path = resolve(root, element);
    if (!existsSync(path) || !statSync(path).isFile() || !insideRepository(path)) continue;
    files[relative(base, path).replaceAll("\\", "/")] = sha(readFileSync(path));
  }
  return { declaration: sha(canonical(declared)), files };
}

/** What differs between what was trusted and what is there now: "declaração" and/or file paths. */
export function changes(trusted: Fingerprint, current: Fingerprint): string[] {
  const out: string[] = [];
  if (trusted.declaration !== current.declaration) out.push("declaração");
  for (const path of new Set([...Object.keys(trusted.files), ...Object.keys(current.files)])) {
    if (trusted.files[path] !== current.files[path]) out.push(path);
  }
  return out;
}
