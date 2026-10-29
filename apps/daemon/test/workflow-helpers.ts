import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRun } from "@flightdeck/protocol";
import type { BoardOptions } from "../src/board/board.ts";
import { git, newBoard } from "./board-helpers.ts";
import { poll } from "./helpers.ts";

/** The example workflow of docs/SPEC-fase-6.md. */
export const EXAMPLE = readFileSync(
  join(import.meta.dir, "fixtures/workflows/feature.yaml"),
  "utf8",
);

/** Writes `.flightdeck/workflows/<name>.yaml` in `cwd` and commits it on the current branch. */
export function commitWorkflow(cwd: string, name: string, yaml: string): void {
  const dir = join(cwd, ".flightdeck", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.yaml`), yaml);
  git(cwd, "add", ".flightdeck/workflows");
  git(cwd, "commit", "-q", "-m", `workflow ${name}`);
}

/** sha256 (hex) of a workflow file, as the daemon computes it. */
export const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/**
 * A board whose repo has `yaml` committed as `.flightdeck/workflows/wf.yaml` on main, already
 * trusted, and a card to start with it.
 */
export async function workflowCard(
  yaml: string,
  options: { board?: Partial<BoardOptions>; delayMs?: number; setupScript?: string } = {},
) {
  const ctx = newBoard(options.board ?? {}, options.delayMs ?? 1);
  commitWorkflow(ctx.repo, "wf", yaml);
  const project = await ctx.board.addProject({
    path: ctx.repo,
    promptTemplate: "",
    ...(options.setupScript ? { setupScript: options.setupScript } : {}),
  });
  await ctx.board.trustWorkflow(project.id, "wf", sha256(yaml));
  const card = ctx.board.createCard(project.id, { title: "Somar", description: "some" });
  const start = (inputs: Record<string, string> = {}) =>
    ctx.board.startCard(card.id, { workflow: "wf", inputs });
  /** The card's current workflow run, `null` before it has one. */
  const run = (): WorkflowRun | null => {
    const id = ctx.board.getCard(card.id).workflowRunId;
    return id ? ctx.board.workflows.getRun(id) : null;
  };
  /** Polls the run until `check` holds; `null` on timeout, so the `expect` after it fails. */
  const runWhen = (check: (run: WorkflowRun) => boolean, timeoutMs = 5000) =>
    poll(() => {
      const current = run();
      return current && check(current) ? current : null;
    }, timeoutMs);
  /** Allows the oldest open permission request of `sessionId`. */
  const allow = (sessionId: string | null | undefined) => {
    const request = ctx.store.pendingPermissions(sessionId ?? "")[0];
    ctx.manager.respondPermission({ requestId: request?.id ?? "", decision: "allow" });
  };
  return { ...ctx, project, card, start, run, runWhen, allow };
}
