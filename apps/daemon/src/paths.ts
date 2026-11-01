import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { FlightdeckError } from "./errors.ts";

const caseInsensitive = process.platform === "win32" || process.platform === "darwin";

function realDir(path: string): string | null {
  try {
    const real = realpathSync.native(resolve(path));
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

/** True when `child` is `root` itself or lies inside it. Both must be real paths. */
export function isInside(root: string, child: string): boolean {
  const a = caseInsensitive ? root.toLowerCase() : root;
  const b = caseInsensitive ? child.toLowerCase() : child;
  const rel = relative(a, b);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Whether two paths name the same place, case blind where the file system is. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (caseInsensitive ? resolve(p).toLowerCase() : resolve(p));
  return norm(a) === norm(b);
}

/**
 * Resolves `cwd` with realpath and refuses it unless it lives inside one of `allowedRoots`. A path
 * that is not a folder is judged where it points: outside every root it is refused as outside,
 * never as missing, so the answer does not tell what exists beyond the roots; only inside a root is
 * it missing.
 */
export function resolveAllowedCwd(cwd: string, allowedRoots: readonly string[]): string {
  const real = realDir(cwd);
  const where = real ?? resolve(cwd);
  for (const root of allowedRoots) {
    const realRoot = realDir(root);
    const inside =
      (realRoot !== null && isInside(realRoot, where)) || (!real && isInside(resolve(root), where));
    if (!inside) continue;
    if (real) return real;
    throw new FlightdeckError("forbidden_cwd", `directory does not exist: ${cwd}`, "cwd_missing", {
      cwd,
    });
  }
  throw new FlightdeckError(
    "forbidden_cwd",
    `directory outside allowedRoots: ${cwd}`,
    "cwd_outside_roots",
    { cwd },
  );
}
