/**
 * Issue #75, slice T1a: a project's Markdown harness shared as a host template. Only Markdown
 * travels: CLAUDE.md, `.claude/agents/*.md` and `.claude/skills/<name>/SKILL.md`. Settings never do
 * (their `env` values, and hooks that run commands, are one project's, not another's). Every file is
 * read without a link, scanned for secrets, and only then is the template written, all or nothing.
 * See docs/decisions/2026-11-08-harness-templates.md.
 */
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  byCodeUnit,
  HARNESS_TEMPLATE_ID,
  type HarnessTemplateInfo,
  type SecretScanner,
} from "@flightdeck/protocol";
import { createInside, readInside } from "../create-inside.ts";
import { FlightdeckError } from "../errors.ts";

/** A template's id: a folder name, lower case, no dot, no slash. */
const ID = HARNESS_TEMPLATE_ID;
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
const MAX_FILE = 32 * 1024;
const MAX_FILES = 16;
const META = "template.json";

const refuse = (reason: string, message: string, params?: Record<string, string>) =>
  new FlightdeckError("invalid_state", message, reason, params);

/** `rel` (a `/` path) inside `root` is a real folder all the way, with no link on the way. */
async function folderInside(root: string, rel: string): Promise<string | null> {
  let at = root;
  for (const segment of rel.split("/")) {
    at = join(at, segment);
    const info = await lstat(at).catch(() => null);
    if (info === null || info.isSymbolicLink() || !info.isDirectory()) return null;
  }
  return at;
}

/** The plain names in a folder inside `root`, sorted; none when the folder is not a real one. */
async function namesIn(root: string, rel: string): Promise<string[]> {
  const folder = await folderInside(root, rel);
  if (folder === null) return [];
  const names = await readdir(folder).catch(() => [] as string[]);
  return names.filter(plainName).sort(byCodeUnit);
}

/**
 * The Markdown parts of a harness under `root`, as [path in the template, path under root]:
 * `layout` is a project's (`.claude/...`) or a template's (top level).
 */
async function parts(root: string, prefix: string): Promise<Array<[string, string]>> {
  const found: Array<[string, string]> = [["CLAUDE.md", "CLAUDE.md"]];
  for (const name of await namesIn(root, `${prefix}agents`)) {
    // The agent's name is the file's without `.md`: `x..md` is `x.`, as a commit reads it.
    if (name.endsWith(".md") && plainName(name.slice(0, -3))) {
      found.push([`agents/${name}`, `${prefix}agents/${name}`]);
    }
  }
  for (const name of await namesIn(root, `${prefix}skills`)) {
    found.push([`skills/${name}/SKILL.md`, `${prefix}skills/${name}/SKILL.md`]);
  }
  return found;
}

type MarkdownPart = "claudeMd" | "agents" | "skills";
type Withheld = "frontmatter" | "secret" | "import" | "command";

/** A template's Markdown as a project would get it (#75, T1b): files to propose, and those held back. */
export interface TemplateMarkdown {
  files: Array<{ part: MarkdownPart; path: string; content: string }>;
  withheld: Array<{ part: MarkdownPart; path: string; reason: Withheld }>;
}

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
const RUNS_COMMAND = /!`|(?:`{3,}|~{3,})!/;

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

/** The part a template file belongs to, by its path in the template. */
function partOf(name: string): MarkdownPart {
  if (name === "CLAUDE.md") return "claudeMd";
  return name.startsWith("agents/") ? "agents" : "skills";
}

/** The host's harness templates, each a folder of `dir`. */
export class HarnessTemplates {
  constructor(
    private readonly dir: string,
    private readonly scanner: Pick<SecretScanner, "scan">,
  ) {}

  /** Copies the Markdown harness of the project at `root` into a new template `id`. */
  async export(root: string, id: string, title: string): Promise<HarnessTemplateInfo> {
    if (!ID.test(id)) throw refuse("harness_template_id", `${id} is not a template id`);
    // The title is listed to every client: no secret in it either.
    if (this.scanner.scan(title).length > 0) {
      throw refuse("harness_template_title_secret", "the title holds a secret: nothing was shared");
    }
    const files: Array<[string, string]> = [];
    for (const [name, from] of await parts(root, ".claude/")) {
      // CLAUDE.md is at the project's top, not under .claude.
      const text = await readInside(root, name === "CLAUDE.md" ? "CLAUDE.md" : from, MAX_FILE);
      if (text === null) continue;
      if (this.scanner.scan(text).length > 0) {
        throw refuse("harness_template_secret", `${name} holds a secret: nothing was shared`, {
          file: name,
        });
      }
      files.push([name, text]);
      if (files.length >= MAX_FILES) break;
    }
    if (files.length === 0) {
      throw refuse(
        "harness_template_empty",
        "the project has no CLAUDE.md, agent or skill to share",
      );
    }
    // The host's own: no other user of the machine reads a template, or plants one.
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const at = join(this.dir, id);
    // Not recursive: a template already there is never written over. Only that is "taken".
    try {
      await mkdir(at, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw refuse("harness_template_taken", `the template ${id} is already there`, { id });
    }
    try {
      for (const [name, text] of files) {
        const creating = createInside(at, name, text);
        if (!(await creating)) throw new Error(`${name} could not be written`); // NOSONAR: in order, so a failure names the first file that could not be written
      }
      const meta = `${JSON.stringify({ id, title }, null, 2)}\n`;
      if (!(await createInside(at, META, meta))) throw new Error(`${META} could not be written`);
    } catch (error) {
      // All or nothing: a template half written is no template.
      await rm(at, { recursive: true, force: true });
      throw error;
    }
    return info(id, title, files);
  }

  /**
   * Template `id`'s Markdown at the paths a project would get it, read again (#75, T1b). A file is
   * withheld, never changed, when it holds a secret (the vault may have grown since the export), an
   * import from outside the project, or, for an agent or a skill, front matter that is not plain.
   */
  async files(id: string): Promise<TemplateMarkdown> {
    if (!ID.test(id)) throw refuse("harness_template_id", `${id} is not a template id`);
    const at = (await folderInside(this.dir, id)) ?? "";
    if (at === "" || (await readInside(at, META, MAX_FILE)) === null) {
      throw refuse("harness_template_missing", `there is no template ${id}`, { id });
    }
    const out: TemplateMarkdown = { files: [], withheld: [] };
    for (const [name] of await parts(at, "")) {
      const reading = readInside(at, name, MAX_FILE);
      const text = await reading; // NOSONAR: the loop stops at the cap, so files past it are never read
      if (text === null) continue;
      const part = partOf(name);
      const path = name === "CLAUDE.md" ? name : `.claude/${name}`;
      const reason = this.withheld(part, text);
      if (reason === null) out.files.push({ part, path, content: text });
      else out.withheld.push({ part, path, reason });
      if (out.files.length + out.withheld.length >= MAX_FILES) break;
    }
    return out;
  }

  /** Why a template file is not proposed, or null when it may be. */
  private withheld(part: MarkdownPart, text: string): Withheld | null {
    if (this.scanner.scan(text).length > 0) return "secret";
    return unvetted(part, text);
  }

  /** The templates on this host: names and sizes, never content. */
  async list(): Promise<HarnessTemplateInfo[]> {
    const ids = (await readdir(this.dir).catch(() => [] as string[])).filter((id) => ID.test(id));
    const out: HarnessTemplateInfo[] = [];
    for (const id of ids.sort(byCodeUnit)) {
      const at = join(this.dir, id);
      const reading = readInside(at, META, MAX_FILE);
      const meta = await reading; // NOSONAR: one template at a time, so a large store is not opened all at once
      if (meta === null) continue;
      // A broken meta costs its title, never the whole list.
      const title = titleOf(meta);
      const files: Array<[string, string]> = [];
      for (const [name] of await parts(at, "")) {
        const reading = readInside(at, name, MAX_FILE);
        const text = await reading; // NOSONAR: a hand-placed template can hold many files, so they are opened one at a time
        if (text !== null) files.push([name, text]);
      }
      out.push(info(id, typeof title === "string" ? title : id, files));
    }
    return out;
  }
}

function titleOf(meta: string): unknown {
  try {
    return (JSON.parse(meta) as { title?: unknown } | null)?.title;
  } catch {
    return undefined;
  }
}

function info(id: string, title: string, files: Array<[string, string]>): HarnessTemplateInfo {
  return {
    id,
    title,
    files: files.map(([name]) => name),
    bytes: files.reduce((sum, [, text]) => sum + Buffer.byteLength(text, "utf8"), 0),
  };
}
