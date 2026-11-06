import {
  NETWORK_TOOLS,
  RANK,
  READ_TOOLS,
  type RiskLevel,
  SECRET_DIRS,
  SECRET_EXTENSIONS,
  SECRET_NAMES,
  SECRET_PAIRS,
  SHELL_TOOLS,
  WRITE_TOOLS,
} from "./risk.ts";

/** What a rule may cover: a level, or `any` for a rule this check cannot show to be narrow. */
export type RuleLevel = RiskLevel | "any";

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
const SENSITIVE = [
  [".claude"],
  [".git"],
  [".github"],
  [".husky"],
  [".vscode"],
  [".ssh"],
  [".aws"],
  [".config"],
  [".flightdeck"],
  [".env"],
  [".env.local"],
  [".mcp.json"],
  [".claude.json"],
  ["package.json"],
  ["id_rsa"],
  ["credentials"],
  [".config", "gh"],
  [".flightdeck", "config.json"],
  [".claude", ".credentials.json"],
  [".github", "workflows"],
  [".vscode", "tasks.json"],
  // What `credential()` names (issue #439): one list, so a rule cannot cover what a call may not.
  ...[...SECRET_NAMES, ...SECRET_DIRS, ...SECRET_EXTENSIONS].map((name) => [name]),
  ...SECRET_PAIRS.map(([dir, next]) => [dir, next]),
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

/**
 * The files that decide what the session may do or run: its own rules, the repository's hooks and
 * config, the scripts a test run starts, the CI. A standing permission to write one lets the
 * session end every hold, so no rule may cover them.
 */
const CONTROL = [
  /(^|\/)\.claude(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.mcp\.json$/,
  /(^|\/)package\.json$/,
  /(^|\/)\.husky(\/|$)/,
  /(^|\/)\.github\/workflows(\/|$)/,
  /(^|\/)\.vscode\/tasks\.json$/,
];
const isControl = (path: string) =>
  CONTROL.some((re) => re.test(path.toLowerCase().replaceAll("\\", "/")));

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

function pathLevel(
  toolName: string,
  content: string | undefined,
  classify: ClassifyCall,
): RuleLevel {
  if (content === undefined || PATH_SYNTAX.test(content) || content.includes("..")) return "any";
  const keys = READ_TOOLS[toolName] ?? ["file_path"];
  const call = (path: string) =>
    classify(toolName, Object.fromEntries(keys.map((key) => [key, path])));
  const pattern = readAs(content);
  // A backslash is a separator on Windows and an escape for the CLI: read the rule both ways, and
  // the broader reading decides (issue #431). A drive path is not refused for its separators.
  const readings = pattern.includes("\\")
    ? [pattern.replaceAll("\\", "/"), pattern.replaceAll("\\", "")]
    : [pattern];
  // Removing a backslash can make a parent step (`.\./`): each reading is checked for one.
  if (readings.some((reading) => reading.includes(".."))) return "any";
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
): RuleLevel {
  if (SHELL_TOOLS.has(toolName)) return shellLevel(toolName, content, classify);
  if (READ_TOOLS[toolName] || WRITE_TOOLS.has(toolName))
    return pathLevel(toolName, content, classify);
  // A network tool names a domain: the whole tool would reach any host.
  if (NETWORK_TOOLS.has(toolName)) {
    return content !== undefined && DOMAIN.test(content) ? classify(toolName, {}) : "any";
  }
  return classify(toolName, {});
}
