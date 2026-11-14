/**
 * The disk look-ups behind the rule checks (#395, #528): `stat` and `realpath` of the paths a rule
 * names, each bounded in count and in time. The rules themselves are pure and live in
 * `domain/rule-risk.ts`.
 */
import { isAbsolute, join, normalize, relative } from "node:path";
import { isInside } from "../kernel/index.ts";
import { type PathKind, type RealPath, WILD, withoutTrailingSlashes } from "./domain/rule-risk.ts";

/** A path as it is when absolute, else under the folder. */
const underFolder = (cwd: string, path: string) => (isAbsolute(path) ? path : join(cwd, path));

/** Where a rule's path is: `~` and `~/` under the home, a relative path under the folder. */
const place = (path: string, cwd: string, home: string) =>
  normalize(/^~(?=$|\/)/.test(path) ? join(home, path.slice(1)) : underFolder(cwd, path));

/** A network path (`//host/share`, `\\host\share`): looking it up would reach another host. */
const network = (path: string) => /^(?:\/\/|\\\\)/.test(path);

/** A look-up's answer, or `fallback` when it fails or takes longer than `ms`. */
function within<T, F>(lookup: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise((done) => {
    const timer = setTimeout(() => done(fallback), ms);
    timer.unref?.();
    lookup.then(done, () => done(fallback));
  });
}

/** At most this many paths are looked up for one answer: the rest count as folders. */
const MAX_LOOKUPS = 32;
/** A look-up that takes longer (a hung network mount) counts as a folder. */
const LOOKUP_MS = 2000;

/**
 * The kind of each exact path a rule names, looked up once with `stat` (relative to the request's
 * folder, `~/` to the home). A path it did not look up counts as a folder: past the cap, a network
 * path (`//host/share`, which would reach another host), one with no folder to start from, and
 * one whose look-up timed out. `target` is the file the request itself writes: missing, it counts
 * as a file, which it will be once the request is allowed.
 */
export async function pathKinds(
  paths: string[],
  cwd: string,
  home: string,
  stat: (path: string) => Promise<"dir" | "file" | "missing">,
  options: { timeoutMs?: number; target?: string } = {},
): Promise<PathKind> {
  const { timeoutMs = LOOKUP_MS, target } = options;
  const at = (path: string) => place(path, cwd, home);
  // A tool writes a relative path under its folder: the target never gets the `~/` reading.
  const created = target === undefined ? undefined : normalize(underFolder(cwd, target));
  const timed = (where: string) => within(stat(where), timeoutMs, "dir" as const);
  const looked = await Promise.all(
    [...new Set(paths)].slice(0, MAX_LOOKUPS).map(async (path) => {
      const where = at(path);
      const plain = isAbsolute(where) && !network(path) && !network(where);
      const kind = plain ? await timed(where) : "dir";
      return [path, kind === "missing" && where === created ? "file" : kind] as const;
    }),
  );
  const kinds = new Map<string, "dir" | "file" | "missing">(looked);
  return (path) => kinds.get(path) ?? "dir";
}

/**
 * The real path of each reading's fixed leading part (#528), looked up once with `resolve`
 * (relative to the request's folder, `~/` to the home). A real path inside the real folder or the
 * real home is written back under the folder or the home the classifier knows.
 */
export async function realPaths(
  readings: string[],
  cwd: string,
  home: string,
  resolve: (path: string) => Promise<string | null>,
  options: { timeoutMs?: number } = {},
): Promise<RealPath> {
  const { timeoutMs = LOOKUP_MS } = options;
  const timed = (where: string) => within(resolve(where), timeoutMs, null);
  const [realCwd, realHome] = await Promise.all([timed(cwd), timed(home)]);
  const known: Array<[string | null, string]> = [
    [realCwd, cwd],
    [realHome, home],
  ];
  const back = (path: string) => {
    for (const [real, name] of known) {
      if (real !== null && isInside(real, path)) return join(name, relative(real, path));
    }
    return path;
  };
  const looked = await Promise.all(
    [...new Set(readings)].slice(0, MAX_LOOKUPS).map(async (reading) => {
      const segments = reading.split("/");
      const wild = segments.findIndex((segment) => WILD.test(segment));
      const fixed = (wild === -1 ? segments : segments.slice(0, wild)).join("/");
      const rest = wild === -1 ? "" : segments.slice(wild).join("/");
      const trimmed = withoutTrailingSlashes(fixed);
      // A leading wildcard starts at the folder itself; a network path is never looked up.
      if (trimmed === "" || network(reading)) return [reading, undefined] as const;
      const where = place(trimmed, cwd, home);
      if (!isAbsolute(where) || network(where)) return [reading, null] as const;
      const resolved = await timed(where);
      if (resolved === null) return [reading, null] as const;
      const real = back(normalize(resolved));
      if (real === where) return [reading, undefined] as const;
      return [reading, rest ? `${real.replaceAll("\\", "/")}/${rest}` : real] as const;
    }),
  );
  const reals = new Map<string, string | null | undefined>(looked);
  // A reading it did not look up (past the cap) is refused.
  return (reading) => (reals.has(reading) ? reals.get(reading) : null);
}
