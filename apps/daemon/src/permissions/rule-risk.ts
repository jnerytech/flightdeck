import {
  NETWORK_TOOLS,
  RANK,
  READ_TOOLS,
  type RiskLevel,
  SHELL_TOOLS,
  WRITE_TOOLS,
} from "./risk.ts";

/** What a rule may cover: a level, or `any` for a rule this check cannot show to be narrow. */
export type RuleLevel = RiskLevel | "any";

/** What the daemon thinks of one tool call: its own classifier, behind a function. */
export type ClassifyCall = (toolName: string, input: Record<string, unknown>) => RiskLevel;

/**
 * The only open shell rules (a prefix that lets any arguments follow) a person may save: read-only
 * forms and the project's own tests and scripts. Any other program can be told to read a
 * credential, write outside the project, or run another program (`env`, `xargs`, `timeout`), and no
 * list of the bad ones keeps up (issue #384). The other rules are an exact command.
 */
const OPEN_SHELL = [
  /^git (?:status|diff|log|show)$/,
  /^(?:npm|pnpm|yarn|bun) test$/,
  /^(?:npm|pnpm|yarn|bun) run [\w:.-]+$/,
];
/** Syntax that makes a prefix more than one command, or hides one. */
const SHELL_SYNTAX = /[;&|<>$`()\n\\"']/;

/** The file names a credential has: a rule that can match one covers a high-risk call. */
const SENSITIVE = [
  ".env",
  ".env.local",
  "id_rsa",
  "x.pem",
  "x.key",
  ".ssh/id_rsa",
  ".aws/credentials",
  ".config/gh/hosts.yml",
  ".claude/.credentials.json",
];

/** Rule syntax of the CLI that this check does not read: a class, an alternation, a negation. */
const PATH_SYNTAX = /[[\]{}!]/;

/** A gitignore-style pattern as a regular expression: `**` crosses folders, `*` and `?` do not. */
function globToRegex(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") {
        i++;
        out += "(?:.*/)?";
      } else out += ".*";
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`);
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
  const wild = pattern.search(/[*?]/);
  if (wild === -1) return call(pattern);
  // Backslashes are an escape in a pattern: this check does not follow them.
  if (pattern.includes("\\")) return "any";
  const folder = pattern.slice(0, pattern.lastIndexOf("/", wild) + 1);
  const matches = globToRegex(pattern);
  if (SENSITIVE.some((name) => matches.test(`${folder}${name}`))) return "any";
  return call(`${folder}x`);
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
  if (NETWORK_TOOLS.has(toolName)) return content === undefined ? "any" : classify(toolName, {});
  return highest([classify(toolName, {})]);
}
