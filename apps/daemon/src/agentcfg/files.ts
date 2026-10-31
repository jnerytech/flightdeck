/**
 * Phase 12: the project's CLAUDE.md files, agents (`.claude/agents`) and skills (`.claude/skills`),
 * editable, and the user's in ~/.claude, read-only. A write asks for confirm and for the hash of
 * the content that was opened, and never lands outside the project.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
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

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

const invalid = (message: string) => new FlightdeckError("invalid_state", message);
const bad = (message: string) => new FlightdeckError("bad_request", message);

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

/** What is wrong with an agent's or a skill's frontmatter, or null. */
function frontmatterProblem(kind: AgentCfgKind, text: string): string | null {
  const data = frontmatter(text);
  if (!data) return "falta o frontmatter YAML entre linhas ---";
  if (!filled(data.name)) return "name é obrigatório";
  if (!filled(data.description)) return "description é obrigatório";
  if (kind !== "agent") return null;
  const { tools, model } = data;
  const toolsOk =
    tools === undefined ||
    typeof tools === "string" ||
    (Array.isArray(tools) && tools.every((t) => typeof t === "string"));
  if (!toolsOk) return "tools é um texto ou uma lista de textos";
  if (model !== undefined && typeof model !== "string") return "model é um texto";
  return null;
}

/** The path with `/` separators, refused when it leaves its root or is not of `kind`. */
function checkedPath(kind: AgentCfgKind, path: string, origin: Origin): string {
  const rel = path.replaceAll("\\", "/");
  const escapes =
    isAbsolute(path) || rel.split("/").some((s) => s === "" || s === "." || s === "..");
  if (escapes || !PATHS[origin][kind].test(rel)) {
    throw bad(`caminho inválido para ${kind}: ${path}`);
  }
  return rel;
}

/** The file inside the project, refused when it, or the folder that would hold it, resolves outside. */
function insideProject(project: string, rel: string): string {
  const root = realpathSync.native(project);
  const file = join(root, rel);
  let existing = file;
  while (!lstatSync(existing, { throwIfNoEntry: false })) existing = dirname(existing);
  if (!isInside(root, realpathSync.native(existing))) throw bad(`${rel} fica fora do projeto`);
  return file;
}

const entries = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []);

/** CLAUDE.md files under the project (not in .git or node_modules), plus the root CLAUDE.local.md. */
function claudeMds(root: string): string[] {
  const found = existsSync(join(root, "CLAUDE.local.md")) ? ["CLAUDE.local.md"] : [];
  const walk = (dir: string, rel: string, depth: number) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === "CLAUDE.md") found.push(`${rel}${entry.name}`);
      // Links are not followed: they may lead outside the project, or in circles.
      if (entry.isDirectory() && !SKIPPED.has(entry.name) && depth < MAX_DEPTH) {
        walk(join(dir, entry.name), `${rel}${entry.name}/`, depth + 1);
      }
    }
  };
  walk(root, "", 0);
  return found;
}

export class AgentConfig {
  constructor(private readonly opts: { claudeDir?: string } = {}) {}

  /** The project's items first, then the user's; each group sorted by path. */
  list(project: string, kind: AgentCfgKind): AgentCfgItem[] {
    return [...this.found(project, kind, "project"), ...this.found(this.claudeDir(), kind, "user")];
  }

  read(
    project: string,
    kind: AgentCfgKind,
    path: string,
    origin: Origin = "project",
  ): AgentCfgItem & { content: string } {
    const root = origin === "user" ? this.claudeDir() : project;
    const rel = checkedPath(kind, path, origin);
    if (!existsSync(join(root, rel))) {
      throw new FlightdeckError("not_found", `${path} não existe`);
    }
    return {
      ...this.item(root, kind, rel, origin),
      content: readFileSync(join(root, rel), "utf8"),
    };
  }

  write(project: string, input: AgentCfgWrite): { hash: string } {
    if (!input.confirm) throw invalid("gravar pede confirm: true");
    if (input.origin === "user")
      throw invalid("a configuração do usuário (~/.claude) é só leitura");
    const rel = checkedPath(input.kind, input.path, "project");
    const problem =
      input.kind === "claudemd" ? null : frontmatterProblem(input.kind, input.content);
    if (problem) throw bad(`frontmatter inválido: ${problem}`);
    const file = insideProject(project, rel);
    const current = existsSync(file) ? sha(readFileSync(file)) : null;
    if (current !== input.expectedHash) {
      throw invalid(
        input.expectedHash === null ? `${rel} já existe` : `${rel} mudou desde que foi aberto`,
      );
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, input.content);
    return { hash: sha(input.content) };
  }

  private claudeDir(): string {
    return this.opts.claudeDir ?? join(userHome(), ".claude");
  }

  private found(root: string, kind: AgentCfgKind, origin: Origin): AgentCfgItem[] {
    const base = origin === "project" ? ".claude/" : "";
    const paths =
      kind === "claudemd"
        ? origin === "project"
          ? claudeMds(root)
          : ["CLAUDE.md"]
        : kind === "agent"
          ? entries(join(root, base, "agents"))
              .filter((e) => e.isFile() && e.name.endsWith(".md"))
              .map((e) => `${base}agents/${e.name}`)
          : entries(join(root, base, "skills")).map((e) => `${base}skills/${e.name}/SKILL.md`);
    return paths
      .filter((p) => existsSync(join(root, p)))
      .sort()
      .map((p) => this.item(root, kind, p, origin));
  }

  private item(root: string, kind: AgentCfgKind, path: string, origin: Origin): AgentCfgItem {
    const bytes = readFileSync(join(root, path));
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
