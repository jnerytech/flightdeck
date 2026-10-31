import type {
  CardTraceInfo,
  UrlTraceInfo,
  WatchInfo,
  WatchSettings,
  WatchUpdatedFrame,
} from "@flightdeck/protocol";
import type { Board } from "../board/board.ts";
import type { PrFixer } from "./fix.ts";
import type { Traces } from "./trace.ts";
import type { PrWatcher } from "./watch.ts";

/** What the server talks to for phase 22: the watch of a card's PR, its rounds and its trail. */
export class PrWatch {
  private readonly listeners = new Set<(frame: WatchUpdatedFrame) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly opts: {
      board: Pick<Board, "getCard" | "getProject">;
      watcher: PrWatcher;
      fixer: PrFixer;
      traces: Traces;
    },
  ) {}

  /** Looks at the watched PRs now and every `ms` after. */
  start(ms: number): void {
    this.timer = setInterval(() => void this.opts.watcher.tick(), ms);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  info(cardId: string): WatchInfo {
    this.opts.board.getCard(cardId);
    const { watcher, fixer } = this.opts;
    return {
      cardId,
      enabled: watcher.enabled(cardId),
      ...watcher.status(cardId),
      rounds: fixer.rounds(cardId),
    };
  }

  set(cardId: string, enabled: boolean | null): WatchInfo {
    this.opts.board.getCard(cardId);
    this.opts.watcher.setEnabled(cardId, enabled);
    this.notify(cardId);
    return this.info(cardId);
  }

  settings(projectId: string, patch?: Partial<WatchSettings>): WatchSettings {
    this.opts.board.getProject(projectId);
    return patch
      ? this.opts.watcher.setSettings(projectId, patch)
      : this.opts.watcher.settings(projectId);
  }

  trace(cardId: string): CardTraceInfo {
    return this.opts.traces.trace(cardId);
  }

  /** The PR description for the person to edit and confirm; nothing is opened. */
  describe(cardId: string): { text: string; redacted: number } {
    this.opts.board.getCard(cardId);
    return this.opts.traces.describe(cardId);
  }

  byUrl(url: string): UrlTraceInfo {
    return this.opts.traces.byUrl(url);
  }

  /** Told to the app: a round started or ended, or the card needs you. */
  notify(cardId: string): void {
    const frame: WatchUpdatedFrame = { type: "watch.updated", watch: this.info(cardId) };
    for (const listener of this.listeners) listener(frame);
  }

  watch(listener: (frame: WatchUpdatedFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
