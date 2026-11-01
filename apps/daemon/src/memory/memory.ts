/**
 * Phase 26: the auto memory Claude Code keeps for a project (`~/.claude/projects/<project>/memory`):
 * the `MEMORY.md` index and one file per topic. Read, and edited only on an explicit action:
 * a write asks for confirm and for the hash of the content that was opened, stays inside the
 * memory folder, and leaves a record of the decision (never the content).
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { frontmatter } from "../agentcfg/files.ts";
import { userHome } from "../config.ts";
import { FlightdeckError } from "../errors.ts";
import { isInside } from "../paths.ts";
import { whichOnPath } from "../which.ts";
import { type ContextBudget, contextBudget } from "./budget.ts";
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
  record?: (decision: MemoryDecision) => void;
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

/** The repository's own folder when `project` is inside one (a worktree answers for its main one). */
function repoRoot(project: string): string {
  const real = realpathSync.native(resolve(project));
  const proc = Bun.spawnSync([whichOnPath("git") ?? "git", "rev-parse", "--git-common-dir"], {
    cwd: real,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) return real;
  const out = proc.stdout.toString().trim();
  const common = realpathSync.native(isAbsolute(out) ? out : resolve(real, out));
  return common.endsWith(".git") ? dirname(common) : real;
}

/** A recorder that appends each decision as a line of JSON to `path`. */
export function decisionLog(path: string): (decision: MemoryDecision) => void {
  return (decision) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(decision)}\n`);
  };
}

/** Where the organization's CLAUDE.md lives on this platform. */
export function managedClaudeMdPath(_platform: NodeJS.Platform = process.platform): string {
  return "/etc/claude-code/CLAUDE.md";
}

export class ProjectMemory {
  constructor(private readonly opts: ProjectMemoryOptions = {}) {}

  /** The memory folder of the project the way Claude Code names it (all worktrees share one). */
  dir(project: string): string {
    const slug = repoRoot(project).replace(/[^A-Za-z0-9]/g, "-");
    return join(this.claudeDir(), "projects", slug, "memory");
  }

  list(project: string): MemoryListing {
    const dir = this.dir(project);
    if (!existsSync(dir)) return { dir, exists: false, files: [] };
    this.safeDir(dir);
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && NAME.test(e.name))
      .map((e) => e.name)
      .sort();
    const index = existsSync(join(dir, INDEX)) ? readFileSync(join(dir, INDEX), "utf8") : "";
    return { dir, exists: true, files: names.map((name) => this.describe(dir, name, index)) };
  }

  read(project: string, name: string): MemoryFile & { content: string } {
    const dir = this.dir(project);
    const file = this.file(dir, name);
    if (!existsSync(file)) throw new FlightdeckError("not_found", `${name} não existe`);
    const index = existsSync(join(dir, INDEX)) ? readFileSync(join(dir, INDEX), "utf8") : "";
    return { ...this.describe(dir, name, index), content: readFileSync(file, "utf8") };
  }

  write(project: string, input: MemoryWrite): { hash: string } {
    if (!input.confirm) throw invalid("gravar pede confirm: true");
    const dir = this.dir(project);
    const file = this.file(dir, input.name);
    const current = existsSync(file) ? sha(readFileSync(file)) : null;
    if (current !== input.expectedHash) {
      throw invalid(
        input.expectedHash === null
          ? `${input.name} já existe`
          : `${input.name} mudou desde que foi aberto`,
      );
    }
    mkdirSync(dir, { recursive: true });
    this.safeDir(dir);
    writeFileSync(file, input.content);
    const hash = sha(input.content);
    this.record("write", input.name, current, hash);
    return { hash };
  }

  remove(project: string, input: MemoryRemove): void {
    if (!input.confirm) throw invalid("apagar pede confirm: true");
    const file = this.file(this.dir(project), input.name);
    if (!existsSync(file)) throw new FlightdeckError("not_found", `${input.name} não existe`);
    const current = sha(readFileSync(file));
    if (current !== input.expectedHash) throw invalid(`${input.name} mudou desde que foi aberto`);
    unlinkSync(file);
    this.record("delete", input.name, current, null);
  }

  /** What the context holds at the start for a session in `project`, and what the memory leaves out. */
  budget(project: string): ContextBudget {
    return contextBudget({
      project,
      claudeDir: this.claudeDir(),
      managedClaudeMd: this.opts.managedClaudeMd ?? managedClaudeMdPath(),
      memoryDir: this.dir(project),
    });
  }

  /** Entries that look duplicated, old, orphaned, broken or in contradiction. Read only. */
  suggest(project: string): MemorySuggestion[] {
    return suggestCleanup(this.dir(project), (this.opts.clock ?? Date.now)());
  }

  private claudeDir(): string {
    return this.opts.claudeDir ?? join(userHome(), ".claude");
  }

  private record(
    action: MemoryDecision["action"],
    name: string,
    before: string | null,
    after: string | null,
  ) {
    const at = new Date((this.opts.clock ?? Date.now)()).toISOString();
    this.opts.record?.({ action, name, before, after, at });
  }

  /** The file's path, refused when the name is not a plain .md name or the folder leads outside. */
  private file(dir: string, name: string): string {
    if (!NAME.test(name)) throw bad(`nome inválido para a memória: ${name}`);
    if (existsSync(dir)) this.safeDir(dir);
    const file = join(dir, name);
    if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw bad(`${name} é um link`);
    }
    return file;
  }

  /** The memory folder must resolve inside the Claude config folder, never through a link out. */
  private safeDir(dir: string): void {
    const root = realpathSync.native(this.claudeDir());
    if (!isInside(root, realpathSync.native(dir))) {
      throw bad("a pasta de memória fica fora da pasta do Claude");
    }
  }

  private describe(dir: string, name: string, index: string): MemoryFile {
    const bytes = readFileSync(join(dir, name));
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
