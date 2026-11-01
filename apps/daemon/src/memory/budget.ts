/**
 * Phase 26: what enters Claude Code's context at the start of a session, source by source, with a
 * rough count of tokens (a quarter of the bytes), and what the memory leaves out: only the start of
 * `MEMORY.md` is loaded. Read only: it never executes anything it reads.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { claudeMds, frontmatter } from "../agentcfg/files.ts";
import { displayPath } from "./display-path.ts";

export type BudgetKind = "managed" | "user" | "project" | "local" | "rules" | "skills" | "memory";

export interface BudgetSource {
  kind: BudgetKind;
  /** Absolute path of the file, written with "/" on every platform. */
  path: string;
  bytes: number;
  /** An estimate: a quarter of the bytes, rounded up. */
  tokens: number;
  /** `start`: in the context from the first message; `on-demand`: only when Claude reads it. */
  load: "start" | "on-demand";
  note?: string;
}

export interface MemoryIndexBudget {
  limitLines: number;
  limitBytes: number;
  indexLines: number;
  indexBytes: number;
  loadedLines: number;
  loadedBytes: number;
  /** What stopped the loading, or null when the whole index fits. */
  cutBy: "lines" | "bytes" | null;
  /** The index lines past the cut (empty ones left out). */
  leftOutLines: string[];
  /** Topic files that only the part past the cut mentions. */
  leftOutFiles: string[];
}

export interface ContextBudget {
  sources: BudgetSource[];
  /** Tokens of everything loaded at the start. */
  startTokens: number;
  memory: MemoryIndexBudget;
}

export const MEMORY_LIMIT_LINES = 200;
export const MEMORY_LIMIT_BYTES = 25 * 1024;

const tokensOf = (bytes: number) => Math.ceil(bytes / 4);

export interface BudgetInput {
  project: string;
  claudeDir: string;
  managedClaudeMd: string;
  /** The project's memory folder (it may not exist). */
  memoryDir: string;
}

/** The `.md` files under `dir`, links not followed, as paths relative to it. */
function markdownUnder(dir: string, rel = "", depth = 0): string[] {
  if (!existsSync(dir) || depth > 6) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isFile() && entry.name.endsWith(".md")) return [`${rel}${entry.name}`];
    return entry.isDirectory()
      ? markdownUnder(join(dir, entry.name), `${rel}${entry.name}/`, depth + 1)
      : [];
  });
}

/** The context at the start of a session in `project`, as far as the files tell. */
export function contextBudget(input: BudgetInput): ContextBudget {
  const sources: BudgetSource[] = [];
  const add = (
    kind: BudgetKind,
    path: string,
    load: BudgetSource["load"],
    bytes: number,
    note?: string,
  ) =>
    sources.push({
      kind,
      path: displayPath(path),
      bytes,
      tokens: tokensOf(bytes),
      load,
      ...(note ? { note } : {}),
    });
  const file = (kind: BudgetKind, path: string, load: BudgetSource["load"]) => {
    if (existsSync(path)) add(kind, path, load, readFileSync(path).length);
  };
  /** Rules with `paths` load only when Claude works on those files. */
  const rules = (dir: string) => {
    for (const rel of markdownUnder(dir).sort((a, b) => (a < b ? -1 : Number(a > b)))) {
      const path = join(dir, rel);
      const scoped = frontmatter(readFileSync(path, "utf8"))?.paths !== undefined;
      add("rules", path, scoped ? "on-demand" : "start", readFileSync(path).length);
    }
  };
  /** A skill's name and description are in the context; the body comes when it is used. */
  const skills = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name, "SKILL.md");
      if (!entry.isDirectory() || !existsSync(path)) continue;
      const data = frontmatter(readFileSync(path, "utf8"));
      if (typeof data?.name !== "string") continue;
      add("skills", path, "start", Buffer.byteLength(`${data.name}: ${data.description ?? ""}`));
    }
  };

  const root = realpathSync.native(resolve(input.project));
  file("managed", input.managedClaudeMd, "start");
  file("user", join(input.claudeDir, "CLAUDE.md"), "start");
  rules(join(input.claudeDir, "rules"));
  skills(join(input.claudeDir, "skills"));
  // The folders above the project load their CLAUDE.md files too.
  for (let dir = dirname(root); dirname(dir) !== dir; dir = dirname(dir)) {
    file("project", join(dir, "CLAUDE.md"), "start");
    file("local", join(dir, "CLAUDE.local.md"), "start");
  }
  const AT_START = new Set(["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"]);
  for (const rel of claudeMds(root)) {
    const path = join(root, rel);
    add(
      rel === "CLAUDE.local.md" ? "local" : "project",
      path,
      AT_START.has(rel) ? "start" : "on-demand",
      readFileSync(path).length,
    );
  }
  rules(join(root, ".claude", "rules"));
  skills(join(root, ".claude", "skills"));

  const memory = memoryIndex(input.memoryDir, add);
  return {
    sources,
    startTokens: sources.filter((s) => s.load === "start").reduce((n, s) => n + s.tokens, 0),
    memory,
  };
}

/** The index is cut at 200 lines or 25 KB, whichever comes first, at the end of a line. */
function memoryIndex(
  dir: string,
  add: (
    kind: BudgetKind,
    path: string,
    load: BudgetSource["load"],
    bytes: number,
    note?: string,
  ) => void,
): MemoryIndexBudget {
  const empty: MemoryIndexBudget = {
    limitLines: MEMORY_LIMIT_LINES,
    limitBytes: MEMORY_LIMIT_BYTES,
    indexLines: 0,
    indexBytes: 0,
    loadedLines: 0,
    loadedBytes: 0,
    cutBy: null,
    leftOutLines: [],
    leftOutFiles: [],
  };
  const indexPath = join(dir, "MEMORY.md");
  if (!existsSync(indexPath)) return empty;
  const text = readFileSync(indexPath, "utf8");
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  let loadedBytes = 0;
  let loadedLines = 0;
  let cutBy: MemoryIndexBudget["cutBy"] = null;
  for (const line of lines) {
    const bytes = Buffer.byteLength(line) + 1;
    if (loadedLines >= MEMORY_LIMIT_LINES) cutBy = "lines";
    else if (loadedBytes + bytes > MEMORY_LIMIT_BYTES) cutBy = "bytes";
    if (cutBy) break;
    loadedBytes += bytes;
    loadedLines += 1;
  }
  const loaded = lines.slice(0, loadedLines).join("\n");
  const leftOutLines = lines.slice(loadedLines).filter((line) => line.trim() !== "");
  const topics = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "MEMORY.md")
    .map((e) => e.name)
    .sort((a, b) => (a < b ? -1 : Number(a > b)));
  add("memory", indexPath, "start", loadedBytes, cutBy ? `cortado por ${cutBy}` : undefined);
  for (const name of topics)
    add("memory", join(dir, name), "on-demand", readFileSync(join(dir, name)).length);
  return {
    ...empty,
    indexLines: lines.length,
    indexBytes: Buffer.byteLength(text),
    loadedLines,
    loadedBytes,
    cutBy,
    leftOutLines,
    leftOutFiles: topics.filter(
      (name) => !loaded.includes(name) && leftOutLines.some((line) => line.includes(name)),
    ),
  };
}
