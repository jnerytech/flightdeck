/**
 * Issue #75, slice T1a: a project's Markdown harness shared as a host template. Only Markdown
 * travels: CLAUDE.md, `.claude/agents/*.md` and `.claude/skills/<name>/SKILL.md`. Settings never do
 * (their `env` values, and hooks that run commands, are one project's, not another's). Every file is
 * read without a link, scanned for secrets, and only then is the template written, all or nothing.
 * See docs/decisions/2026-11-08-harness-templates.md.
 */
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessTemplateInfo, SecretScanner } from "@flightdeck/protocol";
import { createInside, readInside } from "../create-inside.ts";
import { FlightdeckError } from "../errors.ts";

/** A template's id: a folder name, lower case, no dot, no slash. */
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A name an agent or a skill may have: plain characters, no separator. */
const NAME = /^[\w.@+-]{1,64}$/;
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
  return names.filter((name) => NAME.test(name) && !name.startsWith(".")).sort();
}

/**
 * The Markdown parts of a harness under `root`, as [path in the template, path under root]:
 * `layout` is a project's (`.claude/...`) or a template's (top level).
 */
async function parts(root: string, prefix: string): Promise<Array<[string, string]>> {
  const found: Array<[string, string]> = [["CLAUDE.md", "CLAUDE.md"]];
  for (const name of await namesIn(root, `${prefix}agents`)) {
    if (name.endsWith(".md")) found.push([`agents/${name}`, `${prefix}agents/${name}`]);
  }
  for (const name of await namesIn(root, `${prefix}skills`)) {
    found.push([`skills/${name}/SKILL.md`, `${prefix}skills/${name}/SKILL.md`]);
  }
  return found;
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
    await mkdir(this.dir, { recursive: true });
    const at = join(this.dir, id);
    // Not recursive: a template already there is never written over.
    const made = await mkdir(at).then(
      () => true,
      () => false,
    );
    if (!made)
      throw refuse("harness_template_taken", `the template ${id} is already there`, { id });
    try {
      for (const [name, text] of files) {
        if (!(await createInside(at, name, text))) throw new Error(`${name} could not be written`);
      }
      await createInside(at, META, `${JSON.stringify({ id, title }, null, 2)}\n`);
    } catch (error) {
      // All or nothing: a template half written is no template.
      await rm(at, { recursive: true, force: true });
      throw error;
    }
    return info(id, title, files);
  }

  /** The templates on this host: names and sizes, never content. */
  async list(): Promise<HarnessTemplateInfo[]> {
    const ids = (await readdir(this.dir).catch(() => [] as string[])).filter((id) => ID.test(id));
    const out: HarnessTemplateInfo[] = [];
    for (const id of ids.sort()) {
      const at = join(this.dir, id);
      const meta = await readInside(at, META, MAX_FILE);
      if (meta === null) continue;
      const title = (JSON.parse(meta) as { title?: unknown }).title;
      const files: Array<[string, string]> = [];
      for (const [name] of await parts(at, "")) {
        const text = await readInside(at, name, MAX_FILE);
        if (text !== null) files.push([name, text]);
      }
      out.push(info(id, typeof title === "string" ? title : id, files));
    }
    return out;
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
