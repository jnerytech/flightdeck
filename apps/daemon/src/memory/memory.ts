/**
 * Phase 26: the auto memory Claude Code keeps for a project (`~/.claude/projects/<project>/memory`):
 * the `MEMORY.md` index and one file per topic. Read, and edited only on an explicit action:
 * a write asks for confirm and for the hash of the content that was opened, stays inside the
 * memory folder, and leaves a record of the decision (never the content).
 */
import { createHash } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { frontmatter } from "../agentcfg/files.ts";
import { userHome } from "../config.ts";
import { FlightdeckError } from "../errors.ts";
import { isInside } from "../paths.ts";
import { whichOnPath } from "../which.ts";
import { type ContextBudget, contextBudget } from "./budget.ts";
import { exists } from "./exists.ts";
import { suggestCleanup } from "./suggest.ts";

export interface MemoryFile {
  name: string;
  /** sha256 of the file's bytes. */
  hash: string;
  bytes: number;
  lines: number;
  /** The `type` and `description` of the file's frontmatter, when it has them. */
  type?: string;
  description?: string;
  /** Whether `MEMORY.md` mentions the file (the index itself counts). */
  inIndex: boolean;
}

export interface MemoryListing {
  dir: string;
  exists: boolean;
  files: MemoryFile[];
}

export interface MemoryDecision {
  action: "write" | "delete";
  name: string;
  /** The hashes before and after; `null` where the file did not exist or no longer does. */
  before: string | null;
  after: string | null;
  at: string;
}

/** A cleanup the screen suggests; the memory is never edited because of it. */
export interface MemorySuggestion {
  kind: "duplicate" | "broken-link" | "orphan" | "stale" | "contradiction";
  files: string[];
  /** The index line behind a broken link. */
  detail?: string;
}

export interface MemoryWrite {
  name: string;
  content: string;
  /** The hash read when the file was opened; null creates a file that must not exist yet. */
  expectedHash: string | null;
  confirm: boolean;
}

export interface MemoryRemove {
  name: string;
  expectedHash: string;
  confirm: boolean;
}

export interface ProjectMemoryOptions {
  /** `~/.claude` unless told otherwise. */
  claudeDir?: string;
  clock?: () => number;
  /** Told of every write and delete that landed. */
  record?: (decision: MemoryDecision) => void | Promise<void>;
  /** The organization's CLAUDE.md; the platform's own place unless told otherwise. */
  managedClaudeMd?: string;
}

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const invalid = (message: string) => new FlightdeckError("invalid_state", message);
const bad = (message: string) => new FlightdeckError("bad_request", message);

/** A plain file name ending in .md: nothing that leaves the folder, nothing hidden. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,98}\.md$/;
const INDEX = "MEMORY.md";

const lineCount = (text: string) =>
  text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

/** The repository's own folder, from what `git rev-parse --git-common-dir` printed in `real`. */
async function rootFrom(real: string, code: number, out: string): Promise<string> {
  if (code !== 0) return real;
  const common = await realpath(isAbsolute(out) ? out : resolve(real, out));
  return common.endsWith(".git") ? dirname(common) : real;
}

/**
 * The repository's own folder when `project` is inside one (a worktree answers for its main one).
 * Asked again on every call: a folder can become a repository. The event loop keeps serving while
 * git runs.
 */
async function repoRoot(project: string): Promise<string> {
  const real = await realpath(resolve(project));
  const proc = Bun.spawn([whichOnPath("git") ?? "git", "rev-parse", "--git-common-dir"], {
    cwd: real,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return rootFrom(real, code, out.trim());
}

/** A recorder that appends each decision as a line of JSON to `path`. */
export function decisionLog(path: string): (decision: MemoryDecision) => Promise<void> {
  return async (decision) => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(decision)}\n`);
  };
}

/** Where the organization's CLAUDE.md lives on this platform. */
export function managedClaudeMdPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\CLAUDE.md";
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/CLAUDE.md";
  return "/etc/claude-code/CLAUDE.md";
}

export class ProjectMemory {
  constructor(private readonly opts: ProjectMemoryOptions = {}) {}

  /** The memory folder of the project the way Claude Code names it (all worktrees share one). */
  async dir(project: string): Promise<string> {
    const slug = (await repoRoot(project)).replace(/[^A-Za-z0-9]/g, "-");
    return join(this.claudeDir(), "projects", slug, "memory");
  }

  async list(project: string): Promise<MemoryListing> {
    const dir = await this.dir(project);
    if (!(await exists(dir))) return { dir, exists: false, files: [] };
    await this.safeDir(dir);
    const names = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && NAME.test(e.name))
      .map((e) => e.name)
      .sort();
    const index = await this.index(dir);
    const files = await Promise.all(names.map((name) => this.describe(dir, name, index)));
    return { dir, exists: true, files };
  }

  async read(project: string, name: string): Promise<MemoryFile & { content: string }> {
    const dir = await this.dir(project);
    const file = await this.file(dir, name);
    if (!(await exists(file))) throw new FlightdeckError("not_found", `${name} não existe`);
    const index = await this.index(dir);
    return { ...(await this.describe(dir, name, index)), content: await readFile(file, "utf8") };
  }

  async write(project: string, input: MemoryWrite): Promise<{ hash: string }> {
    if (!input.confirm) throw invalid("gravar pede confirm: true");
    const dir = await this.dir(project);
    const file = await this.file(dir, input.name);
    const current = (await exists(file)) ? sha(await readFile(file)) : null;
    if (current !== input.expectedHash) {
      throw invalid(
        input.expectedHash === null
          ? `${input.name} já existe`
          : `${input.name} mudou desde que foi aberto`,
      );
    }
    await mkdir(dir, { recursive: true });
    await this.safeDir(dir);
    await writeFile(file, input.content);
    const hash = sha(input.content);
    await this.record("write", input.name, current, hash);
    return { hash };
  }

  async remove(project: string, input: MemoryRemove): Promise<void> {
    if (!input.confirm) throw invalid("apagar pede confirm: true");
    const file = await this.file(await this.dir(project), input.name);
    if (!(await exists(file))) throw new FlightdeckError("not_found", `${input.name} não existe`);
    const current = sha(await readFile(file));
    if (current !== input.expectedHash) throw invalid(`${input.name} mudou desde que foi aberto`);
    await unlink(file);
    await this.record("delete", input.name, current, null);
  }

  /** What the context holds at the start for a session in `project`, and what the memory leaves out. */
  async budget(project: string): Promise<ContextBudget> {
    return contextBudget({
      project,
      claudeDir: this.claudeDir(),
      managedClaudeMd: this.opts.managedClaudeMd ?? managedClaudeMdPath(),
      memoryDir: await this.dir(project),
    });
  }

  /** Entries that look duplicated, old, orphaned, broken or in contradiction. Read only. */
  async suggest(project: string): Promise<MemorySuggestion[]> {
    return suggestCleanup(await this.dir(project), (this.opts.clock ?? Date.now)());
  }

  private claudeDir(): string {
    return this.opts.claudeDir ?? join(userHome(), ".claude");
  }

  private async record(
    action: MemoryDecision["action"],
    name: string,
    before: string | null,
    after: string | null,
  ) {
    const at = new Date((this.opts.clock ?? Date.now)()).toISOString();
    await this.opts.record?.({ action, name, before, after, at });
  }

  /** The text of `MEMORY.md`, or nothing when the folder has none. */
  private async index(dir: string): Promise<string> {
    const path = join(dir, INDEX);
    return (await exists(path)) ? await readFile(path, "utf8") : "";
  }

  /** The file's path, refused when the name is not a plain .md name or the folder leads outside. */
  private async file(dir: string, name: string): Promise<string> {
    if (!NAME.test(name)) throw bad(`nome inválido para a memória: ${name}`);
    if (await exists(dir)) await this.safeDir(dir);
    const file = join(dir, name);
    const info = await lstat(file).catch(() => undefined);
    if (info?.isSymbolicLink()) throw bad(`${name} é um link`);
    return file;
  }

  /** The memory folder must resolve inside the Claude config folder, never through a link out. */
  private async safeDir(dir: string): Promise<void> {
    const root = await realpath(this.claudeDir());
    if (!isInside(root, await realpath(dir))) {
      throw bad("a pasta de memória fica fora da pasta do Claude");
    }
  }

  private async describe(dir: string, name: string, index: string): Promise<MemoryFile> {
    const bytes = await readFile(join(dir, name));
    const text = bytes.toString("utf8");
    const data = name === INDEX ? null : frontmatter(text);
    const type = typeof data?.type === "string" ? data.type : undefined;
    const description = typeof data?.description === "string" ? data.description : undefined;
    return {
      name,
      hash: sha(bytes),
      bytes: bytes.length,
      lines: lineCount(text),
      ...(type ? { type } : {}),
      ...(description ? { description } : {}),
      inIndex: name === INDEX || index.includes(name),
    };
  }
}
