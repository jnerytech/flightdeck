import type { Database } from "bun:sqlite";
import type { EventEnvelope, SessionSummary } from "@flightdeck/protocol";
import { PrFixer, type PrFixerOptions } from "./fix.ts";
import { PrWatch } from "./service.ts";
import { Traces, type TracesOptions } from "./trace.ts";
import { PrWatcher, type PrWatcherOptions } from "./watch.ts";

/** What the watch of the cards' PRs is built from: the ports its classes and traces read. */
export interface WatchDeps {
  store: { db: Database; eventsSince(sessionId: string, sinceSeq?: number): EventEnvelope[] };
  board: PrWatcherOptions["board"] &
    PrFixerOptions["board"] &
    TracesOptions["board"] &
    ConstructorParameters<typeof PrWatch>[0]["board"];
  manager: { get(sessionId: string): Pick<SessionSummary, "claudeSessionId" | "name"> };
  costs: { sessions: TracesOptions["sessionCosts"]; card: TracesOptions["cardCost"] };
  snapshots: { list(claudeSessionId: string): readonly unknown[] };
  history: {
    search(query: { query: string; limit: number }): ReturnType<TracesOptions["search"]>;
  };
  scanner: TracesOptions["scanner"];
  /** Runs the project's local checks in the card's worktree. */
  checks: PrFixerOptions["checks"];
}

/**
 * Phase 22 (issue #1593): the PRs of the cards are watched and fixed, inside their limits, and each
 * card's trace says what ran for it. The caller starts and stops the watch, in its own boot and
 * shutdown order.
 */
export function createWatch({
  store,
  board,
  manager,
  costs,
  snapshots,
  history,
  scanner,
  checks,
}: WatchDeps) {
  const watcher = new PrWatcher({
    db: store.db,
    board,
    onTrigger: (trigger) => fixer.onTrigger(trigger),
  });
  const fixer = new PrFixer({
    db: store.db,
    board,
    watcher,
    checks,
    onUpdate: (cardId) => watch.notify(cardId),
  });
  const traces = new Traces({
    scanner,
    db: store.db,
    board,
    fixer,
    claudeSessionOf: (sessionId) => manager.get(sessionId).claudeSessionId,
    describeSession: (sessionId) => ({
      name: manager.get(sessionId).name,
      request:
        store
          .eventsSince(sessionId, 0)
          .map((envelope) => envelope.event)
          .flatMap((event) => (event.type === "message.user" ? [event.text] : []))[0] ?? null,
    }),
    sessionCosts: (ids) => costs.sessions(ids),
    cardCost: (cardId) => costs.card(cardId),
    checkpoints: (claudeSessionId) => snapshots.list(claudeSessionId).length,
    search: (query) => {
      const seen = new Map<
        string,
        { claudeSessionId: string; title: string | null; cwd: string }
      >();
      for (const hit of history.search({ query: `"${query.replaceAll('"', "")}"`, limit: 20 })) {
        seen.set(hit.claudeSessionId, {
          claudeSessionId: hit.claudeSessionId,
          title: hit.title,
          cwd: hit.cwd,
        });
      }
      return [...seen.values()];
    },
  });
  const watch = new PrWatch({ board, watcher, fixer, traces });
  return { watcher, fixer, watch };
}
