/**
 * Phase 12: the project's CLAUDE.md files, agents (`.claude/agents`) and skills (`.claude/skills`),
 * editable, and the user's in ~/.claude, read-only. A write asks for confirm and for the hash of
 * the content that was opened, and never lands outside the project.
 */

import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { byCodeUnit, inSequence } from "@flightdeck/protocol";
import { userHome } from "../config.ts";
import { FlightdeckError } from "../errors.ts";
import { isInside } from "../paths.ts";

export type AgentCfgKind = "claudemd" | "agent" | "skill";
type Origin = "project" | "user";

export interface AgentCfgItem {
  kind: AgentCfgKind;
  /** Relative to the project, or to ~/.claude for the user's. */
  path: string;
  origin: Origin;
  readOnly: boolean;
  /** sha256 of the file's bytes. */
  hash: string;
  name?: string;
  description?: string;
}

export interface AgentCfgWrite {
  kind: AgentCfgKind;
  path: string;
  content: string;
  /** The hash read when the file was opened; null creates a file that must not exist yet. */
  expectedHash: string | null;
  confirm: boolean;
  origin?: Origin;
}

/** Folders the CLAUDE.md search skips: they hold other people's files. */
const SKIPPED = new Set([".git", "node_modules"]);
const MAX_DEPTH = 8;

/** The paths each kind may have, relative to the project and to ~/.claude. */
const PATHS: Record<Origin, Record<AgentCfgKind, RegExp>> = {
  project: {
    claudemd: /^(?:(?:[^/]+\/)*CLAUDE\.md|CLAUDE\.local\.md)$/,
    agent: /^\.claude\/agents\/[^/]+\.md$/,
    skill: /^\.claude\/skills\/[^/]+\/SKILL\.md$/,
  },
  user: {
    claudemd: /^CLAUDE\.md$/,
    agent: /^agents\/[^/]+\.md$/,
    skill: /^skills\/[^/]+\/SKILL\.md$/,
  },
};

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

type Params = Record<string, string | number>;
const invalid = (message: string, reason: string, params?: Params) =>
  new FlightdeckError("invalid_state", message, reason, params);
const bad = (message: string, reason: string, params?: Params) =>
  new FlightdeckError("bad_request", message, reason, params);

/**
 * The YAML between the leading `---` lines; null when there is none or it does not parse. YAML
 * that is not a mapping (empty, a list, a bare text) has no `name`, so it is refused all the same.
 */
export function frontmatter(text: string): Record<string, unknown> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  try {
    return Bun.YAML.parse(match[1] as string) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

const filled = (value: unknown) => typeof value === "string" && value.trim() !== "";

/** What is wrong with an agent's or a skill's frontmatter, as a refusal, or null. */
function frontmatterProblem(kind: AgentCfgKind, text: string): FlightdeckError | null {
  const data = frontmatter(text);
  if (!data) {
    return bad("the YAML frontmatter between --- lines is missing", "agentcfg_frontmatter_missing");
  }
  for (const field of ["name", "description"]) {
    if (!filled(data[field])) {
      return bad(`${field} is required`, "agentcfg_field_required", { field });
    }
  }
  if (kind !== "agent") return null;
  const { tools, model } = data;
  const toolsOk =
    tools === undefined ||
    typeof tools === "string" ||
    (Array.isArray(tools) && tools.every((t) => typeof t === "string"));
  if (!toolsOk) return bad("tools is a text or a list of texts", "agentcfg_tools_type");
  if (model !== undefined && typeof model !== "string") {
    return bad("model is a text", "agentcfg_model_type");
  }
  return null;
}

/** The path with `/` separators, refused when it leaves its root or is not of `kind`. */
function checkedPath(kind: AgentCfgKind, path: string, origin: Origin): string {
  const rel = path.replaceAll("\\", "/");
  const escapes =
    isAbsolute(path) || rel.split("/").some((s) => s === "" || s === "." || s === "..");
  if (escapes || !PATHS[origin][kind].test(rel)) {
    throw bad(`invalid path for ${kind}: ${path}`, "agentcfg_path_invalid", { kind, path });
  }
  return rel;
}

/** The file inside the project, refused when it, or the folder that would hold it, resolves outside. */
async function insideProject(project: string, rel: string): Promise<string> {
  const root = await realpath(project);
  const file = join(root, rel);
  let existing = file;
  while (!(await lstat(existing).catch(() => null))) existing = dirname(existing);
  if (!isInside(root, await realpath(existing)))
    throw bad(`${rel} is outside the project`, "agentcfg_outside_project", { path: rel });
  return file;
}

const entries = (dir: string): Promise<Dirent[]> =>
  readdir(dir, { withFileTypes: true }).catch(() => []);

/** CLAUDE.md files under the project (not in .git or node_modules), plus the root CLAUDE.local.md. */
export async function claudeMds(root: string): Promise<string[]> {
  const found = (await exists(join(root, "CLAUDE.local.md"))) ? ["CLAUDE.local.md"] : [];
  const walk = async (dir: string, rel: string, depth: number) => {
    await inSequence(await readdir(dir, { withFileTypes: true }), async (entry) => {
      if (entry.isFile() && entry.name === "CLAUDE.md") found.push(`${rel}${entry.name}`);
      // Links are not followed: they may lead outside the project, or in circles.
      if (entry.isDirectory() && !SKIPPED.has(entry.name) && depth < MAX_DEPTH) {
        await walk(join(dir, entry.name), `${rel}${entry.name}/`, depth + 1);
      }
    });
  };
  await walk(root, "", 0);
  return found;
}

export class AgentConfig {
  constructor(private readonly opts: { claudeDir?: string } = {}) {}

  /** The project's items first, then the user's; each group sorted by path. */
  async list(project: string, kind: AgentCfgKind): Promise<AgentCfgItem[]> {
    return [
      ...(await this.found(project, kind, "project")),
      ...(await this.found(this.claudeDir(), kind, "user")),
    ];
  }

  async read(
    project: string,
    kind: AgentCfgKind,
    path: string,
    origin: Origin = "project",
  ): Promise<AgentCfgItem & { content: string }> {
    const root = origin === "user" ? this.claudeDir() : project;
    const rel = checkedPath(kind, path, origin);
    const bytes = await readFile(join(root, rel)).catch(() => null);
    if (!bytes)
      throw new FlightdeckError("not_found", `${path} does not exist`, "agentcfg_file_missing", {
        path,
      });
    return {
      ...this.itemOf(bytes, kind, rel, origin),
      content: bytes.toString("utf8"),
    };
  }

  async write(project: string, input: AgentCfgWrite): Promise<{ hash: string }> {
    if (!input.confirm) throw invalid("writing needs confirm: true", "agentcfg_confirm");
    if (input.origin === "user")
      throw invalid("the user's configuration (~/.claude) is read-only", "agentcfg_user_readonly");
    const rel = checkedPath(input.kind, input.path, "project");
    const problem =
      input.kind === "claudemd" ? null : frontmatterProblem(input.kind, input.content);
    if (problem) throw problem;
    const file = await insideProject(project, rel);
    const before = await readFile(file).catch(() => null);
    if ((before ? sha(before) : null) !== input.expectedHash) {
      throw input.expectedHash === null
        ? invalid(`${rel} already exists`, "agentcfg_exists", { path: rel })
        : invalid(`${rel} changed since it was opened`, "agentcfg_changed", { path: rel });
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, input.content);
    return { hash: sha(input.content) };
  }

  private claudeDir(): string {
    return this.opts.claudeDir ?? join(userHome(), ".claude");
  }

  /** The files of one kind: every CLAUDE.md, the agents' .md files, or each skill's SKILL.md. */
  private async pathsOf(
    root: string,
    kind: AgentCfgKind,
    origin: Origin,
    base: string,
  ): Promise<string[]> {
    if (kind === "claudemd") return origin === "project" ? await claudeMds(root) : ["CLAUDE.md"];
    if (kind === "agent") {
      return (await entries(join(root, base, "agents")))
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => `${base}agents/${e.name}`);
    }
    return (await entries(join(root, base, "skills"))).map(
      (e) => `${base}skills/${e.name}/SKILL.md`,
    );
  }

  private async found(root: string, kind: AgentCfgKind, origin: Origin): Promise<AgentCfgItem[]> {
    const base = origin === "project" ? ".claude/" : "";
    const paths = await this.pathsOf(root, kind, origin, base);
    const items: AgentCfgItem[] = [];
    await inSequence([...paths].sort(byCodeUnit), async (path) => {
      const bytes = await readFile(join(root, path)).catch(() => null);
      if (bytes) items.push(this.itemOf(bytes, kind, path, origin));
    });
    return items;
  }

  private itemOf(bytes: Buffer, kind: AgentCfgKind, path: string, origin: Origin): AgentCfgItem {
    const data = kind === "claudemd" ? null : frontmatter(bytes.toString("utf8"));
    return {
      kind,
      path,
      origin,
      readOnly: origin === "user",
      hash: sha(bytes),
      ...(filled(data?.name) ? { name: data?.name as string } : {}),
      ...(filled(data?.description) ? { description: data?.description as string } : {}),
    };
  }
}
