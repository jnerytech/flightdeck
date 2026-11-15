import type { Database } from "bun:sqlite";
import { watch } from "node:fs";
import { basename } from "node:path";
import { inSequence } from "@flightdeck/protocol";
import { IndexStore } from "./adapters/index-store.ts";
import { listTranscripts, readSlice, transcriptStat } from "./adapters/transcript-files.ts";
import { lastTitle, parseLines } from "./domain/parser.ts";
import { isExcludedCwd, normalizeCwd } from "./folder.ts";
import { HistoryQueries, type HistorySession } from "./queries.ts";
import { fts5Available } from "./search.ts";

export interface HistoryIndexerOptions {
  db: Database;
  /** Folders holding one directory per project, each with `<claudeSessionId>.jsonl` files. */
  roots: readonly string[];
  /** Sessions whose `cwd` is one of these folders, or inside one, are never indexed. */
  excludeCwds?: readonly string[];
  /** Whether SQLite has FTS5; detected when absent (injectable so tests cover both paths). */
  fts5?: boolean;
  log?: (message: string) => void;
  /** The name Claude Code wrote into a transcript, once per pass that read one (issue #605). */
  onTitle?: (claudeSessionId: string, title: string, kind: "custom" | "agent") => void;
  /** Fallback full pass while running (file watching is the fast path). Default 10 s. */
  scanIntervalMs?: number;
  /** Clock for `maybeActive`. */
  now?: () => number;
  /** Timers (tests drive them by hand). */
  timers?: IndexerTimers;
  /** File watcher; `fs.watch` when absent. */
  watch?: (root: string, onEvent: () => void) => { close(): void };
  /** Wait after a file event before the pass that publishes `history.changed`. */
  watchDebounceMs?: number;
  /** The most bytes of one file a background pass reads before it gives the event loop back. */
  sliceBytes?: number;
  /** What a background pass awaits between slices; a zero timer when absent. */
  pause?: () => Promise<void>;
}

export interface IndexerTimers {
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void;
}

export interface HistoryChange {
  claudeSessionId: string;
  cwd: string;
  lastTs: string | null;
  maybeActive: boolean;
}

export interface IndexResult {
  claudeSessionId: string;
  path: string;
  /** Records stored by this pass. */
  added: number;
  /** The file shrank and was indexed again from the start. */
  reset: boolean;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** How much of a file a background pass reads before it gives the event loop back (about 25 ms). */
const SLICE_BYTES = 1 << 20;

const zeroTimer = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Default wait between a file event and the pass that publishes `history.changed`. */
const WATCH_DEBOUNCE_MS = 250;

/**
 * Indexes Claude Code transcripts incrementally: each file remembers the byte offset after the
 * last newline read, and the next pass reads only what came after it.
 */
export class HistoryIndexer {
  private readonly store: IndexStore;
  private readonly queries: HistoryQueries;
  private readonly excludes: string[];
  private readonly listeners = new Set<(change: HistoryChange) => void>();
  private readonly watchers: Array<{ close(): void }> = [];
  private readonly timers: IndexerTimers;
  private timer: ReturnType<typeof setInterval> | null = null;
  private boot: ReturnType<typeof setTimeout> | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  /** `stop` was called: no pass starts, and the one running is the last. */
  private stopped = false;
  /** Full-text search through FTS5; `LIKE` otherwise. */
  readonly fts: boolean;

  constructor(readonly opts: HistoryIndexerOptions) {
    this.timers = opts.timers ?? globalThis;
    this.excludes = (opts.excludeCwds ?? []).map(normalizeCwd);
    this.fts = opts.fts5 ?? fts5Available(opts.db);
    this.store = new IndexStore(opts.db, this.fts);
    this.queries = new HistoryQueries(opts.db, this.fts, opts.now);
    opts.log?.(
      this.fts ? "histórico: busca com FTS5" : "histórico: FTS5 indisponível, busca com LIKE",
    );
    if (this.fts) this.store.createFts();
    this.store.repairTitles();
  }

  /** The reads live in `HistoryQueries`; the indexer keeps them as its public face. */
  distinctCwds(...args: Parameters<HistoryQueries["distinctCwds"]>) {
    return this.queries.distinctCwds(...args);
  }

  list(...args: Parameters<HistoryQueries["list"]>) {
    return this.queries.list(...args);
  }

  transcriptFile(...args: Parameters<HistoryQueries["transcriptFile"]>) {
    return this.queries.transcriptFile(...args);
  }

  session(...args: Parameters<HistoryQueries["session"]>) {
    return this.queries.session(...args);
  }

  tool(...args: Parameters<HistoryQueries["tool"]>) {
    return this.queries.tool(...args);
  }

  get(...args: Parameters<HistoryQueries["get"]>) {
    return this.queries.get(...args);
  }

  lastActivity(...args: Parameters<HistoryQueries["lastActivity"]>) {
    return this.queries.lastActivity(...args);
  }

  userPrompts(...args: Parameters<HistoryQueries["userPrompts"]>) {
    return this.queries.userPrompts(...args);
  }

  cursorFor(...args: Parameters<HistoryQueries["cursorFor"]>) {
    return this.queries.cursorFor(...args);
  }

  search(...args: Parameters<HistoryQueries["search"]>) {
    return this.queries.search(...args);
  }

  /** Called with every transcript that gained lines, after each pass. */
  onChange(listener: (change: HistoryChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Boot pass, then file watching with a periodic full pass as the fallback. */
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.boot = this.timers.setTimeout(() => this.safeScan(), 0);
    this.timer = this.timers.setInterval(() => this.safeScan(), this.opts.scanIntervalMs ?? 10_000);
    const watchRoot =
      this.opts.watch ?? ((root, onEvent) => watch(root, { recursive: true }, onEvent));
    for (const root of this.opts.roots) {
      try {
        this.watchers.push(watchRoot(root, () => this.schedule()));
      } catch (error) {
        this.opts.log?.(`histórico: sem observação de ${root} (${describe(error)})`);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) this.timers.clearInterval(this.timer);
    if (this.boot) this.timers.clearTimeout(this.boot);
    if (this.pending) this.timers.clearTimeout(this.pending);
    this.timer = this.boot = this.pending = null;
    for (const watcher of this.watchers.splice(0)) watcher.close();
  }

  /**
   * Bursts of file events become one pass, `watchDebounceMs` after the first: with the watcher
   * on, `history.changed` goes out well within the 2 s of the live reader.
   */
  private schedule(): void {
    if (this.pending) return;
    this.pending = this.timers.setTimeout(() => {
      this.pending = null;
      this.safeScan();
    }, this.opts.watchDebounceMs ?? WATCH_DEBOUNCE_MS);
  }

  private safeScan(): void {
    this.request();
  }

  /** Drops everything indexed and reads every transcript again from the start. */
  async rebuild(): Promise<{ sessions: number; messages: number }> {
    this.store.clear();
    await this.scan();
    return this.store.counts();
  }

  /**
   * A pass that gives the event loop back after every slice of every file: the first pass over a
   * large history is minutes of parsing that must not hold the protocol. It indexes exactly what
   * `scan` does, and reports each file once, with its slices added up.
   */
  async scanAsync(): Promise<IndexResult[]> {
    this.store.claimManaged();
    const pause = this.opts.pause ?? zeroTimer;
    const sliceBytes = this.opts.sliceBytes ?? SLICE_BYTES;
    const results: IndexResult[] = [];
    await inSequence(await listTranscripts(this.opts.roots), async (path) => {
      let merged = null as IndexResult | null;
      for (;;) {
        const { result, more } = await this.indexSlice(path, sliceBytes); // NOSONAR: sequential by design: each pass needs the answer of the one before
        if (result) {
          merged = merged
            ? { ...merged, added: merged.added + result.added, reset: merged.reset || result.reset }
            : result;
        }
        await pause(); // NOSONAR: poll interval: the wait between looks is the point of this loop
        if (!more) break;
      }
      if (merged) {
        results.push(merged);
        this.notify(merged.claudeSessionId);
      }
    });
    return results;
  }

  /** Another background pass after the one running; requests made meanwhile become one. */
  request(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = (async () => {
      do {
        this.again = false;
        try {
          await this.scanAsync(); // NOSONAR: sequential by design: each pass needs the answer of the one before
        } catch (error) {
          this.opts.log?.(`histórico: falha na varredura (${describe(error)})`);
        }
      } while (this.again && !this.stopped);
      this.running = null;
    })();
  }

  /** Resolves when no background pass is running. */
  async idle(): Promise<void> {
    await this.running;
  }

  /** One pass over every root; returns the files that gained records. */
  async scan(): Promise<IndexResult[]> {
    this.store.claimManaged();
    const results: IndexResult[] = [];
    await inSequence(await listTranscripts(this.opts.roots), async (path) => {
      const result = await this.indexFile(path);
      if (result) results.push(result);
    });
    for (const { claudeSessionId } of results) this.notify(claudeSessionId);
    return results;
  }

  private notify(claudeSessionId: string): void {
    const { cwd, lastTs, maybeActive } = this.session(claudeSessionId) as HistorySession;
    for (const listener of this.listeners) listener({ claudeSessionId, cwd, lastTs, maybeActive });
  }

  private async indexFile(path: string): Promise<IndexResult | null> {
    return (await this.indexSlice(path, Number.POSITIVE_INFINITY)).result;
  }

  /**
   * Reads and stores the next `maxBytes` of a file, up to its last whole line (a line bigger than
   * that is read whole); `more` says there is still unread text after it.
   */
  private async indexSlice(
    path: string,
    maxBytes: number,
  ): Promise<{ result: IndexResult | null; more: boolean }> {
    const stat = await transcriptStat(path);
    const claudeSessionId = basename(path, ".jsonl");
    const row = this.store.fileRow(path);
    // Smaller than what was already read: truncated or swapped, so start over.
    const reset = stat.size < (row?.offset ?? 0);
    const offset = reset ? 0 : (row?.offset ?? 0);
    if (!reset && stat.size === offset) return { result: null, more: false };

    const { chunk, end } = await readSlice(path, offset, stat.size, maxBytes);
    if (end === 0 && !reset) return { result: null, more: false };
    const { records, errors } = parseLines(chunk.subarray(0, end).toString("utf8"));

    // An excluded file keeps its row with a null session id, so later passes skip it unread.
    const wasExcluded = !reset && row !== null && row.claude_session_id === null;
    const cwd = wasExcluded
      ? ""
      : this.store.sessionCwd(claudeSessionId) || records.find((r) => r.cwd)?.cwd || "";
    const excluded = wasExcluded || isExcludedCwd(cwd, this.excludes);

    this.store.write({
      claudeSessionId,
      path,
      cwd,
      records,
      excluded,
      reset,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      offset: offset + end,
      parseErrors: (reset ? 0 : (row?.parse_errors ?? 0)) + errors,
    });
    const title = excluded ? null : lastTitle(records);
    if (title) this.opts.onTitle?.(claudeSessionId, title.name, title.kind);
    return {
      result: excluded ? null : { claudeSessionId, path, added: records.length, reset },
      more: offset + end < stat.size && end > 0,
    };
  }
}
