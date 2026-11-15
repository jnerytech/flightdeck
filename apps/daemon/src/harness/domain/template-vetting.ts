/**
 * The rules that vet what travels in a harness template: which names an agent or a skill may have, and
 * which Markdown a project may take (no command run on load, no import from outside the project, only
 * plain front matter keys). Pure: no filesystem. See docs/decisions/2026-11-08-harness-templates.md.
 */

/** A name an agent or a skill may have: plain characters, no separator. */
const NAME = /^[\w.@+-]{1,64}$/;

/** A name Windows opens as a device, whatever its extension (`CON`, `aux.md`, `NUL`). */
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * A name an agent or a skill may have: plain characters, not hidden (never `.` or `..`), not a
 * Windows device, and no trailing dot, which Windows drops (`ship.` would be `ship`).
 */
export const plainName = (name: string): boolean =>
  NAME.test(name) && !name.startsWith(".") && !name.endsWith(".") && !DEVICE_NAME.test(name);

export type MarkdownPart = "claudeMd" | "agents" | "skills";
export type Withheld = "frontmatter" | "secret" | "import" | "command";

/**
 * The front matter keys a template's agent or skill may carry: what names, describes and narrows it.
 * Anything else (`hooks`, `mcpServers`, `permissionMode`, `allowed-tools`, a key Claude Code adds
 * later) could run a command or grant a permission in the project that takes the template.
 */
const PLAIN_KEYS = new Set([
  "name",
  "description",
  "tools",
  "disallowedTools",
  "model",
  "color",
  "effort",
  "maxTurns",
  "argument-hint",
  "disable-model-invocation",
  "user-invocable",
]);
const KEY_LINE = /^([A-Za-z][\w-]*):(?:\s|$)/;
/** Line breaks other than `\n` that some YAML parser may honour: never inside a block we vet. */
const ODD_BREAK = /[\r\u0085\u2028\u2029]/;

/**
 * Whether the text opens with a front matter block of plain keys only, read two ways so a parser
 * that differs from Claude Code's cannot hide a key: line by line (it opens on its first line with
 * exactly `---`, the first `---` line closes it, and each line between is blank, a comment, indented
 * with spaces, a `- ` item or `<plain key>:`), and as YAML, a map of plain keys.
 */
function plainFrontmatter(text: string): boolean {
  const lines = text.split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end < 0) return false;
  const block = lines.slice(1, end);
  for (const line of block) {
    if (ODD_BREAK.test(line)) return false;
    if (line.trim() === "" || line.startsWith("#") || line.startsWith("- ") || /^ +\S/.test(line)) {
      continue;
    }
    const key = KEY_LINE.exec(line)?.[1];
    if (key === undefined || !PLAIN_KEYS.has(key)) return false;
  }
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(block.join("\n"));
  } catch {
    return false;
  }
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.keys(parsed).every((key) => PLAIN_KEYS.has(key))
  );
}

/**
 * A shell command a skill or a command runs as it loads: `!` then a backtick, inline, or a fence of
 * any length opened with `!`, wherever it starts. Withheld anywhere, CLAUDE.md included.
 */
// A longer fence opened with `!` holds three of its marks then `!`: the same matches, no backtracking.
const RUNS_COMMAND = /!`|(?:`{3}|~{3})!/;

/**
 * An `@` import (as CLAUDE.md has) of a file outside the project: from the home folder, an absolute
 * path, a drive, or one that climbs with `..`. It would load that file into every session there.
 */
function importsOutside(text: string): boolean {
  for (const [, target = ""] of text.matchAll(/(?:^|\s)@(\S+)/g)) {
    if (/^[~/\\]|^[A-Za-z]:/.test(target)) return true;
    if (target.split(/[/\\]/).includes("..")) return true;
  }
  return false;
}

/**
 * Why a Markdown part would not be proposed from a template, the secret scan aside: it runs a
 * command as it loads, imports a file from outside the project, or (an agent or a skill) its front
 * matter is not plain. A commit of the setup vets an agent or a skill the same way.
 */
export function unvetted(part: MarkdownPart, text: string): Exclude<Withheld, "secret"> | null {
  if (RUNS_COMMAND.test(text)) return "command";
  if (importsOutside(text)) return "import";
  if (part !== "claudeMd" && !plainFrontmatter(text)) return "frontmatter";
  return null;
}
