import { confirmationHash } from "../../src/board/domain/check-loop-engine.ts";
import { PrWatcher } from "../../src/watch/watch.ts";
import type { BoundedCheckResult } from "../../src/workflows/check-runner.ts";
import { newBoard } from "../support/board-helpers.ts";

/** What the check-loop board tests clean up after themselves; `teardown` runs it, last in first. */
export const cleanups: Array<() => unknown> = [];
export async function teardown() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

export const FAILED: BoundedCheckResult = { exitCode: 1, output: "1 failed: login" };
export const PASSED: BoundedCheckResult = { exitCode: 0, output: "" };

export async function setup(results: BoundedCheckResult[] = [FAILED, PASSED]) {
  const ran: string[] = [];
  const answers = [...results];
  let gate: Promise<void> | null = null;
  let during: (() => void) | null = null;
  const finished: string[] = [];
  /** A killed check takes this long to exit: the test opens it when it says. */
  let killGate: Promise<void> | null = null;
  const runner = {
    run: async (command: string, _cwd: string, _timeoutMs?: number, signal?: AbortSignal) => {
      ran.push(command);
      during?.();
      // A held check ends when it is let go, or when it is killed (its signal aborts).
      if (gate) {
        await Promise.race([
          gate,
          new Promise<void>((done) => signal?.addEventListener("abort", () => done())),
        ]);
      }
      if (signal?.aborted && killGate) await killGate;
      finished.push(signal?.aborted ? "killed" : "done");
      if (signal?.aborted) return { exitCode: 137, output: "", aborted: true };
      return answers.shift() ?? PASSED;
    },
  };
  let watcher: PrWatcher | null = null;
  const ctx = newBoard({
    maxParallelRuns: 1,
    checkLoop: {
      settings: (projectId: string) => (watcher as PrWatcher).settings(projectId),
      isTrusted: () => true,
      runner,
    },
  });
  cleanups.push(() => ctx.board.stop());
  watcher = new PrWatcher({ db: ctx.store.db, board: ctx.board });
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  watcher.setSettings(project.id, { checks: ["bun test"] });
  const card = ctx.board.createCard(project.id, { title: "Login", description: "faça o login" });
  const switchOn = (cardId: string) =>
    ctx.board.storeCheckLoop(cardId, {
      on: true,
      rounds: null,
      confirmedAt: new Date().toISOString(),
      confirmedHash: confirmationHash(["bun test"], [], "default"),
    });
  return {
    ...ctx,
    project,
    card,
    ran,
    finished,
    switchOn,
    duringCheck: (fn: () => void) => (during = fn),
    holdKill: () => {
      let open = () => {};
      killGate = new Promise<void>((done) => (open = done));
      return open;
    },
    holdChecks: () => {
      let open = () => {};
      gate = new Promise<void>((done) => (open = done));
      return () => {
        gate = null;
        open();
      };
    },
    rounds: (cardId: string) => {
      try {
        return ctx.store.db
          .query<{ n: number; status: string; reason: string | null }, [string]>(
            "SELECT n, status, reason FROM card_check_rounds WHERE card_id = ? ORDER BY id",
          )
          .all(cardId);
      } catch {
        // No such table or column yet: no rounds, so the expect below says what is missing.
        return [];
      }
    },
  };
}

/** The text of every user message the card's session got, in order. */
export function prompts(ctx: Awaited<ReturnType<typeof setup>>, cardId: string): string[] {
  const sessionId = ctx.board.getCard(cardId).sessionId;
  if (!sessionId) return [];
  return ctx.store
    .eventsSince(sessionId, 0)
    .filter((envelope) => envelope.event.type === "message.user")
    .map((envelope) => String((envelope.event as { text?: string }).text ?? ""));
}
