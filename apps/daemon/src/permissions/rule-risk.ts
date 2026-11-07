import { isAbsolute, join, normalize, relative } from "node:path";
import { isInside } from "../paths.ts";
import {
  NETWORK_TOOLS,
  RANK,
  READ_TOOLS,
  type RiskLevel,
  SHELL_TOOLS,
  WRITE_TOOLS,
} from "./risk.ts";
import {
  CONTROL_DIRS,
  CONTROL_NAMES,
  CONTROL_PAIRS,
  isControl,
  SECRET_DIRS,
  SECRET_EXTENSIONS,
  SECRET_NAMES,
  SECRET_PAIRS,
} from "./sensitive-paths.ts";

/** What a rule may cover: a level, or `any` for a rule this check cannot show to be narrow. */
export type RuleLevel = RiskLevel | "any";

/** What a path a rule names is on disk: a folder rule covers its whole subtree in the CLI (#395). */
export type PathKind = (path: string) => "dir" | "file" | "missing";

/**
 * A rule's reading with its fixed leading part (everything before the first wildcard segment)
 * replaced by its real path, behind any symlink (#528): undefined when no link is on the way,
 * null when it could not be resolved (the rule is then refused).
 */
export type RealPath = (reading: string) => string | null | undefined;

/**
 * What the disk says about a rule's paths, looked up by the server before the check: their kind
 * (#395; without it each counts as a folder) and their real path (#528).
 */
export interface DiskView {
  kind?: PathKind;
  real?: RealPath;
}

/** What the daemon thinks of one tool call: its own classifier, behind a function. */
export type ClassifyCall = (toolName: string, input: Record<string, unknown>) => RiskLevel;

/**
 * The only open shell rules (a prefix that lets any arguments follow) a person may save: the
 * status of the repository, and the project's own tests and scripts. Any other program can be told
 * to read a credential, write outside the project, or run another program (`env`, `xargs`,
 * `timeout`); `git diff`, `log` and `show` take `--output` (they write a file) and run the programs
 * `.git/config` names. No list of the bad ones keeps up (issue #384). The other rules are an exact
 * command. A script name starts with a letter, a digit or `_`: an option or a file is not one.
 */
const OPEN_SHELL = [
  /^git status$/,
  /^(?:npm|pnpm|yarn|bun) test$/,
  /^(?:npm|pnpm|yarn|bun) run \w[\w:-]*$/,
];
/** Syntax that makes a prefix more than one command, or hides one. */
const SHELL_SYNTAX = /[;&|<>$`()\n\\"']/;

/** Rule syntax of the CLI that this check does not read: a class, an alternation, a negation. */
const PATH_SYNTAX = /[[\]{}!]/;

/** What a wildcard of a path rule may stand for: the names the classifier calls a credential. */
const NAMES = ["x", ".env", "id_rsa", "x.pem", "x.key", ".ssh", ".aws", "credentials"];
/**
 * The paths a partial wildcard (`.cl*`, `.s?h`, `package.js*`, `.github/work*`) may stand for, as
 * segments: the control files and directories and the credential ones (issue #435). A wildcard
 * that shares a segment with other characters is matched against each, over every run of
 * consecutive segments, so a path that is sensitive only as a pair (`.config/gh`) is found too.
 */
const SENSITIVE: string[][] = [
  ...CONTROL_DIRS.map((name) => [name]),
  ...CONTROL_NAMES.map((name) => [name]),
  ...CONTROL_PAIRS.flatMap(([dir, next]) => [[dir], [dir, next]]),
  ...[...SECRET_NAMES, ...SECRET_DIRS, ...SECRET_EXTENSIONS].map((name) => [name]),
  ...SECRET_PAIRS.map(([dir, next]) => [dir, next]),
  // Partial names of what a whole-name check would not reach: a folder that holds both kinds, and
  // the files a prefix stands for.
  [".config"],
  [".flightdeck"],
  [".env.local"],
  ["id_rsa"],
  ["credentials"],
];
/** A segment's glob as a regular expression (`*` and `?` stay inside the segment). */
const segmentGlob = (segment: string) =>
  new RegExp(
    `^${segment
      .replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
      .replace(/\*+/g, "[^/]*")
      .replaceAll("?", "[^/]")}$`,
    "i",
  );
/** What a `?` may stand for, one character at a time. */
const CHARS = [..."abcdefghijklmnopqrstuvwxyz0123456789._-"];
const WILDCARD = /(\*\*\/|\*\*|\*|\?)/;
/** Whether a pattern has a wildcard at all. */
const WILD = /[*?]/;
const MAX_WILDCARDS = 6;

/** What a network rule must say: `domain:` and a host with at least two labels, one `*.` at most. */
const DOMAIN = /^domain:(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

/** What one wildcard can stand for: a character, a run of directories (or none), or a name. */
function wildcardOptions(part: string): string[] {
  if (part === "?") return CHARS;
  return part === "**/" ? ["", ...NAMES.map((name) => `${name}/`)] : NAMES;
}

// The wildcard as `name`: `?` is one plain character, a double star a directory of that name.
function wildcardAsName(part: string, name: string): string {
  if (part === "?") return "x";
  return part === "**/" ? `${name}/` : name;
}

/**
 * The paths a rule's pattern could stand for: each wildcard in turn becomes each of the names a
 * credential has (the others stay `x`), then all of them the same name. `null` when there are too
 * many wildcards to look at.
 */
function instances(pattern: string): string[] | null {
  const parts = pattern.split(WILDCARD);
  const wildcards = parts.filter((_, i) => i % 2 === 1);
  if (wildcards.length > MAX_WILDCARDS) return null;
  const plain = (part: string) => (part === "**/" ? "" : "x");
  const render = (pick: (k: number, part: string) => string) => {
    let k = 0;
    return parts.map((part, i) => (i % 2 === 0 ? part : pick(k++, part))).join("");
  };
  const out = new Set<string>([render((_, part) => plain(part))]);
  wildcards.forEach((part, at) => {
    for (const option of wildcardOptions(part)) {
      out.add(render((k, p) => (k === at ? option : plain(p))));
    }
  });
  for (const name of NAMES) {
    out.add(render((_, part) => wildcardAsName(part, name)));
  }
  // A wildcard that shares a segment with other characters may still be a sensitive path there.
  const segments = pattern.split("/");
  const globs = segments.map((segment) => (WILD.test(segment) ? segmentGlob(segment) : null));
  const plainSegment = (segment: string) => segment.replace(/\*+|\?/g, "x");
  for (const names of SENSITIVE) {
    for (let at = 0; at + names.length <= segments.length; at++) {
      const run = names.map(
        (name, k) => [name, segments[at + k] as string, globs[at + k]] as const,
      );
      const partial = run.some(([, , glob]) => glob !== null);
      const fits = run.every(([name, segment, glob]) =>
        glob ? glob.test(name) : segment.toLowerCase() === name,
      );
      if (!partial || !fits) continue;
      out.add(
        segments
          .map((segment, i) =>
            i >= at && i < at + names.length ? names[i - at] : plainSegment(segment),
          )
          .join("/"),
      );
    }
  }
  return [...out];
}

/** A rule's path as the CLI reads it: `//abs` is absolute, a single leading `/` is the project's root. */
const readAs = (content: string) =>
  content.startsWith("//") ? content.slice(1) : content.replace(/^\//, "");

const highest = (levels: RiskLevel[]): RiskLevel =>
  levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "low" as RiskLevel);

function shellLevel(
  toolName: string,
  content: string | undefined,
  classify: ClassifyCall,
): RuleLevel {
  if (content === undefined) return "any";
  if (!content.includes("*")) return classify(toolName, { command: content });
  // Open: a trailing `:*` or ` *` after a whole command, and nothing else with a wildcard.
  const open = /^(.*?)(?::\*| \*)$/.exec(content);
  const prefix = (open?.[1] ?? "").trim();
  if (!open || prefix.includes("*") || SHELL_SYNTAX.test(prefix)) return "any";
  return OPEN_SHELL.some((form) => form.test(prefix))
    ? classify(toolName, { command: prefix })
    : "any";
}

/**
 * How a path rule may be read: its content without the leading `/` of a project path, both ways
 * when it has a backslash (a separator on Windows, an escape for the CLI, issue #431); null when
 * this check cannot read it (brackets, braces, `!`, a parent step).
 */
function readingsOf(content: string | undefined): string[] | null {
  if (content === undefined || PATH_SYNTAX.test(content) || content.includes("..")) return null;
  const pattern = readAs(content);
  // A drive path is not refused for its separators.
  const readings = pattern.includes("\\")
    ? [pattern.replaceAll("\\", "/"), pattern.replaceAll("\\", "")]
    : [pattern];
  // Removing a backslash can make a parent step (`.\./`): each reading is checked for one.
  return readings.some((reading) => reading.includes("..")) ? null : readings;
}

/** Every reading of a path rule, as `ruleLevel` asks `real` about them (#528). */
export function pathReadings(toolName: string, content: string | undefined): string[] {
  if (!READ_TOOLS[toolName] && !WRITE_TOOLS.has(toolName)) return [];
  return readingsOf(content) ?? [];
}

/** The paths a rule names exactly (no wildcard), as `ruleLevel` asks `kind` about them. */
export function exactPaths(toolName: string, content: string | undefined): string[] {
  return pathReadings(toolName, content).filter((reading) => !WILD.test(reading));
}

function pathLevel(
  toolName: string,
  content: string | undefined,
  classify: ClassifyCall,
  kind: PathKind,
  real: RealPath,
): RuleLevel {
  const read = readingsOf(content);
  if (!read) return "any";
  // A symlink on the way makes the rule reach its real path too (#528): both are rated, and the
  // real path has the kind of the path it stands for (stat follows the link).
  const behind = read.map(real);
  if (behind.includes(null)) return "any";
  const pairs = read.flatMap((reading, i) => {
    const to = behind[i];
    return to
      ? [[reading, reading] as const, [to, reading] as const]
      : [[reading, reading] as const];
  });
  const keys = READ_TOOLS[toolName] ?? ["file_path"];
  const call = (path: string) =>
    classify(toolName, Object.fromEntries(keys.map((key) => [key, path])));
  // The CLI matches a rule the gitignore way: a folder covers everything below it. Only a file on
  // disk is read as itself; a folder, a path ending with a slash, and a path not there yet (it can
  // be made a folder once the rule is saved) are read with their subtree too (issue #395).
  const readings = pairs.flatMap(([reading, of]) =>
    !WILD.test(reading) && (reading.endsWith("/") || kind(of) !== "file")
      ? [reading, `${withoutTrailingSlashes(reading)}/**`]
      : [reading],
  );
  const wild = readings.some((reading) => WILD.test(reading));
  const reached = readings.map((reading) => (WILD.test(reading) ? instances(reading) : [reading]));
  if (reached.includes(null)) return "any";
  const named = (reached as string[][]).flat();
  if (WRITE_TOOLS.has(toolName) && named.some(isControl)) return "any";
  const levels = named.map(call);
  // A pattern that can stand for a credential covers a high-risk call: it is not narrow.
  if (wild && levels.includes("high")) return "any";
  return highest(levels);
}

/**
 * The most risk a rule `toolName(content)` could cover: the daemon's classifier on what it names,
 * and `any` for whatever this check cannot show to be narrow, which no request may save. `content` undefined is a rule for
 * the whole tool. A saved rule must not cover more than the request it came from (issue #384).
 */
export function ruleLevel(
  toolName: string,
  content: string | undefined,
  classify: ClassifyCall,
  kind: PathKind,
  real: RealPath = () => undefined,
): RuleLevel {
  if (SHELL_TOOLS.has(toolName)) return shellLevel(toolName, content, classify);
  if (READ_TOOLS[toolName] || WRITE_TOOLS.has(toolName))
    return pathLevel(toolName, content, classify, kind, real);
  // A network tool names a domain: the whole tool would reach any host.
  if (NETWORK_TOOLS.has(toolName)) {
    return content !== undefined && DOMAIN.test(content) ? classify(toolName, {}) : "any";
  }
  return classify(toolName, {});
}

/** A path as it is when absolute, else under the folder. */
const underFolder = (cwd: string, path: string) => (isAbsolute(path) ? path : join(cwd, path));

/** The path without the slashes at its end (a loop: a `/\/+$/` pattern backtracks on a long run). */
function withoutTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end--;
  return path.slice(0, end);
}

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

/** The file a request is about to write (Write, Edit, MultiEdit, NotebookEdit), or undefined. */
export function writeTarget(toolName: string, input: Record<string, unknown>): string | undefined {
  if (!WRITE_TOOLS.has(toolName)) return undefined;
  const file = input.file_path ?? input.notebook_path;
  return typeof file === "string" && file !== "" ? file : undefined;
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
