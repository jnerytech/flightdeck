import { isAbsolute, join } from "node:path";
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
  /^(?:npm|pnpm|yarn|bun) run [A-Za-z0-9_][\w:-]*$/,
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
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*+/g, "[^/]*")
      .replace(/\?/g, "[^/]")}$`,
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
  const options = (part: string) =>
    part === "?" ? CHARS : part === "**/" ? ["", ...NAMES.map((name) => `${name}/`)] : NAMES;
  const out = new Set<string>([render((_, part) => plain(part))]);
  wildcards.forEach((part, at) => {
    for (const option of options(part)) {
      out.add(render((k, p) => (k === at ? option : plain(p))));
    }
  });
  for (const name of NAMES) {
    out.add(render((_, part) => (part === "?" ? "x" : part === "**/" ? `${name}/` : name)));
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

/** The paths a rule names exactly (no wildcard), as `ruleLevel` asks `kind` about them. */
export function exactPaths(toolName: string, content: string | undefined): string[] {
  if (!READ_TOOLS[toolName] && !WRITE_TOOLS.has(toolName)) return [];
  return (readingsOf(content) ?? []).filter((reading) => !WILD.test(reading));
}

function pathLevel(
  toolName: string,
  content: string | undefined,
  classify: ClassifyCall,
  kind: PathKind,
): RuleLevel {
  const read = readingsOf(content);
  if (!read) return "any";
  const keys = READ_TOOLS[toolName] ?? ["file_path"];
  const call = (path: string) =>
    classify(toolName, Object.fromEntries(keys.map((key) => [key, path])));
  // The CLI matches a rule the gitignore way: a folder covers everything below it, so a folder on
  // disk, or a path that ends with a slash, is read with its subtree too (issue #395).
  const readings = read.flatMap((reading) =>
    !WILD.test(reading) && (reading.endsWith("/") || kind(reading) === "dir")
      ? [reading, `${reading.replace(/\/+$/, "")}/**`]
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
): RuleLevel {
  if (SHELL_TOOLS.has(toolName)) return shellLevel(toolName, content, classify);
  if (READ_TOOLS[toolName] || WRITE_TOOLS.has(toolName))
    return pathLevel(toolName, content, classify, kind);
  // A network tool names a domain: the whole tool would reach any host.
  if (NETWORK_TOOLS.has(toolName)) {
    return content !== undefined && DOMAIN.test(content) ? classify(toolName, {}) : "any";
  }
  return classify(toolName, {});
}

/**
 * The kind of each exact path a rule names, looked up once with `stat` (relative to the request's
 * folder, `~/` to the home): a path it did not look up counts as a folder.
 */
export async function pathKinds(
  paths: string[],
  cwd: string,
  home: string,
  stat: (path: string) => Promise<"dir" | "file" | "missing">,
): Promise<PathKind> {
  const at = (path: string) =>
    path.startsWith("~/") ? join(home, path.slice(2)) : isAbsolute(path) ? path : join(cwd, path);
  const looked = await Promise.all(
    [...new Set(paths)].map(async (path) => {
      const where = at(path);
      // A relative path with no folder to start from is not looked up: it counts as a folder.
      return [path, isAbsolute(where) ? await stat(where) : "dir"] as const;
    }),
  );
  const kinds = new Map<string, "dir" | "file" | "missing">(looked);
  return (path) => kinds.get(path) ?? "dir";
}
