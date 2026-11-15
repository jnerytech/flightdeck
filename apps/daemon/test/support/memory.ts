import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type MemoryDecision, ProjectMemory } from "../../src/memory/memory.ts";
import { gitRepo } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";

export const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const codeOf = async (fn: () => unknown): Promise<string> => {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
};
export const slugOf = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");

export function setup() {
  const claudeDir = tempDir("fd-claude-");
  const { repo } = gitRepo();
  const decisions: MemoryDecision[] = [];
  const memory = new ProjectMemory({
    claudeDir,
    clock: () => Date.UTC(2026, 9, 31, 12),
    record: (d) => {
      decisions.push(d);
    },
  });
  const dir = join(claudeDir, "projects", slugOf(repo), "memory");
  const put = (name: string, text: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), text);
  };
  return { claudeDir, repo, memory, decisions, dir, put };
}
