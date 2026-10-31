/**
 * Phase 26: what enters Claude Code's context at the start of a session, source by source, with a
 * rough count of tokens (a quarter of the bytes), and what the memory leaves out: only the start of
 * `MEMORY.md` is loaded. Read only: it never executes anything it reads.
 */

export type BudgetKind = "managed" | "user" | "project" | "local" | "rules" | "skills" | "memory";

export interface BudgetSource {
  kind: BudgetKind;
  /** Absolute path of the file. */
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
