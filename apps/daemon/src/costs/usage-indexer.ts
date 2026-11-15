import type { Database } from "bun:sqlite";
import { z } from "zod";
import { isExcludedCwd, normalizeCwd } from "../history/index.ts";
import { parseJsonOr, type UsageTokens, ulid } from "../kernel/index.ts";
import { localDay } from "../quota/index.ts";
import {
  listTranscripts,
  readSlice,
  sizeOf,
  type TranscriptFile,
} from "./adapters/transcript-files.ts";
import { UsageStore } from "./adapters/usage-store.ts";
import { readLine } from "./domain/transcript-line.ts";

/** Where the usage of a message came from. */
export type UsageOrigin =
  | "terminal"
  | "app"
  | "card"
  | "workflow"
  | "subagent"
  | "auto-approve"
  | "assistant";

export interface UsageIndexerOptions {
  db: Database;
  /** Folders holding one directory per project (the history roots). */
  roots: readonly string[];
  /** Transcripts whose `cwd` is one of these folders, or inside one, are never read. */
  excludeCwds?: readonly string[];
  /** Phase 5's `projectKey` of a folder. */
  projectKey: (cwd: string) => string;
  /** `YYYY-MM-DD` of an instant in the host's time zone. */
  day?: (ms: number) => string;
  /** Estimated cost of a message; `null` when its model has no price. */
  cost?: (tokens: UsageTokens) => number | null;
  /** Awaited between files of a pass, so the daemon keeps answering; a zero timer when absent. */
  pause?: () => Promise<void>;
  /** The most bytes of one file a pass reads before it pauses; the rest comes next. */
  sliceBytes?: number;
  /** Looks the project keys of folders up without waiting for git, before a slice that names them is read. */
  warmKeys?: (cwds: string[]) => Promise<unknown>;
  log?: (message: string) => void;
  /** After each pass, with the entries it added (budgets are checked again). */
  onPass?: (added: number) => void;
}

/** The first pass of the process: every transcript that already exists. */
export interface InitialLoad {
  state: "running" | "done";
  filesDone: number;
  filesTotal: number;
}

/** Whose session this is: the managed kind and, for cards and workflows, the project folder. */
interface Owner {
  origin: Exclude<UsageOrigin, "subagent">;
  projectPath: string | null;
}

/** How much of a file a pass reads before it pauses (about 25 ms of parsing). */
const SLICE_BYTES = 1 << 20;

const zeroTimer = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The usage of every assistant message of the transcripts, read incrementally with offsets of
 * its own (`usage_files`). Claude Code writes one line per content block, each with the same
 * `message.id` and usage, so the id is the key: a message counts once, also when read again.
 */
export class UsageIndexer {
  private readonly store: UsageStore;
  private readonly excludes: string[];
  private readonly day: (ms: number) => string;
  private load: InitialLoad = { state: "running", filesDone: 0, filesTotal: 0 };
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(readonly opts: UsageIndexerOptions) {
    this.store = new UsageStore(opts.db);
    this.excludes = (opts.excludeCwds ?? []).map(normalizeCwd);
    this.day = opts.day ?? localDay;
  }

  /**
   * Phase 13: usage the daemon spends itself, with no transcript (the automatic approval's
   * queries run with persistSession false): origin `auto-approve`.
   */
  record(entry: {
    at: string;
    model: string;
    tokens: UsageTokens;
    projectPath: string;
    messageId?: string;
    origin?: UsageOrigin;
    provider?: string;
    costUsd?: number;
  }): void {
    const { tokens } = entry;
    const origin = entry.origin ?? "auto-approve";
    // The id is the table's key: a record sent twice (the app's pending queue) is one row.
    this.store.insertRecord({
      id: entry.messageId ?? `${origin}-${ulid()}`,
      at: entry.at,
      day: this.day(Date.parse(entry.at)),
      key: this.opts.projectKey(entry.projectPath),
      model: entry.model,
      origin,
      speed: tokens.speed,
      input: tokens.input,
      output: tokens.output,
      cacheRead: tokens.cacheRead,
      cache5m: tokens.cacheWrite5m,
      cache1h: tokens.cacheWrite1h,
      // What the provider billed wins over the table; a model with neither stays unpriced.
      cost: entry.costUsd ?? this.opts.cost?.(tokens) ?? null,
      provider: entry.provider ?? null,
    });
  }

  /** Progress of the first pass. */
  status(): InitialLoad {
    return { ...this.load };
  }

  /** The first pass (every transcript that already exists), in the background. */
  start(): void {
    this.request();
  }

  /** Another pass after the one running; requests made meanwhile become one. */
  request(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await /* NOSONAR: sequential by design: each pass needs the answer of the one before */ this.pass().catch(
          (error: unknown) =>
            this.opts.log?.(`custos: falha na leitura de uso (${describe(error)})`),
        );
      } while (this.again && !this.stopped);
      this.running = null;
    })();
  }

  /** Resolves when no pass is running. */
  async idle(): Promise<void> {
    await this.running;
  }

  /** No pass starts after this; resolves when the running one ends. */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.running;
  }

  /** One pass over every transcript and subagent transcript; returns the entries added. */
  async pass(): Promise<number> {
    this.reclassify();
    const owners = new Map<string, Owner>();
    const files = await listTranscripts(this.opts.roots);
    const first = this.load.state === "running";
    if (first) this.load = { state: "running", filesDone: 0, filesTotal: files.length };
    let added = 0;
    for (const file of files) {
      if (this.stopped) break;
      let owner = owners.get(file.claudeSessionId);
      if (!owner) {
        owner = this.owner(file.claudeSessionId);
        owners.set(file.claudeSessionId, owner);
      }
      added += await this.indexSlices(file, owner, first); // NOSONAR: files are indexed one at a time: each updates the shared load counter and the database
    }
    if (first) {
      this.load.state = "done";
      this.opts.log?.(
        `custos: carga inicial concluída (${files.length} transcripts, ${added} mensagens)`,
      );
    }
    this.opts.onPass?.(added);
    return added;
  }

  /** Reads a file slice by slice until it is all in; returns the entries added. */
  private async indexSlices(file: TranscriptFile, owner: Owner, first: boolean): Promise<number> {
    let added = 0;
    for (;;) {
      if (this.opts.warmKeys) await this.warm(file, owner); // NOSONAR: sequential by design: each pass needs the answer of the one before
      const slice = await this.indexFile(file, owner, this.opts.sliceBytes ?? SLICE_BYTES); // NOSONAR: sequential by design: each pass needs the answer of the one before
      added += slice.added;
      // The file counts as done when its last slice is in, before the pause that follows it.
      if (first && !slice.more) this.load.filesDone++;
      await (this.opts.pause ?? zeroTimer)(); // NOSONAR: poll interval: the wait between looks is the point of this loop
      if (!slice.more || this.stopped) return added;
    }
  }

  /** Sessions read as the terminal's that a managed session claimed since (its id came later). */
  private reclassify(): void {
    for (const id of this.store.claimedTerminalSessions()) {
      const owner = this.owner(id);
      this.store.reclassify(
        id,
        owner.origin,
        owner.projectPath === null ? null : this.opts.projectKey(owner.projectPath),
      );
    }
  }

  private owner(claudeSessionId: string): Owner {
    const row = this.store.owner(claudeSessionId);
    if (row.workflow !== null) return { origin: "workflow", projectPath: row.workflow };
    if (row.card !== null) return { origin: "card", projectPath: row.card };
    return { origin: row.app ? "app" : "terminal", projectPath: null };
  }

  /**
   * Looks up the project key of every folder the next slice of the file names, before the
   * (synchronous) parse asks for it: asking git is the one thing in a pass that can take long.
   * Reads the slice once more for it; it is the same bytes, and the page cache has them.
   */
  private async warm(file: TranscriptFile, owner: Owner): Promise<void> {
    const size = await sizeOf(file.path);
    if (size === null || !this.opts.warmKeys) return;
    const row = this.store.file(file.path);
    const offset = size < (row?.offset ?? 0) ? 0 : (row?.offset ?? 0);
    if (size === offset) return;
    const chunk = await readSlice(
      file.path,
      offset,
      Math.min(size - offset, this.opts.sliceBytes ?? SLICE_BYTES),
    );
    const cwds = new Set<string>([row?.cwd ?? ""]);
    for (const [, escaped] of chunk.toString("utf8").matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)) {
      cwds.add(parseJsonOr(z.string(), `"${escaped}"`, ""));
    }
    // An excluded folder never reaches the project-key lookup (it would be a git call on it).
    const folders = new Set(
      [...cwds].filter((cwd) => cwd !== "" && !isExcludedCwd(cwd, this.excludes)),
    );
    if (owner.projectPath) folders.add(owner.projectPath);
    await this.opts.warmKeys([...folders]);
  }

  /**
   * Reads what the file gained since the last pass (all of it when it shrank), at most `maxBytes`
   * of it up to a line's end (a line bigger than that is read whole); `more` says there is text
   * after what was read.
   */
  private async indexFile(
    file: TranscriptFile,
    owner: Owner,
    maxBytes: number,
  ): Promise<{ added: number; more: boolean }> {
    const done = { added: 0, more: false };
    // Gone since the listing (a session deleted meanwhile): nothing to read.
    const size = await sizeOf(file.path);
    if (size === null) return done;
    const row = this.store.file(file.path);
    const reset = size < (row?.offset ?? 0);
    const offset = reset ? 0 : (row?.offset ?? 0);
    if (!reset && size === offset) return done;
    let chunk: Buffer = Buffer.alloc(Math.min(size - offset, maxBytes));
    let end = 0;
    for (;;) {
      chunk = await readSlice(file.path, offset, chunk.length); // NOSONAR: sequential by design: each pass needs the answer of the one before
      // Only complete lines: a last line without its newline is left for the next pass.
      end = chunk.lastIndexOf(0x0a) + 1;
      if (end > 0 || chunk.length >= size - offset) break;
      // No end of line in the slice: the line is bigger than it, so read on until it ends.
      chunk = Buffer.alloc(Math.min(size - offset, chunk.length * 2));
    }
    let cwd = row?.cwd ?? null;
    let added = 0;
    const reads = chunk
      .subarray(0, end)
      .toString("utf8")
      .split("\n")
      .map((line) => readLine(line));
    // The folder of the lines that come before the first `cwd` is the first one the file names (a
    // session that changed folders before that line is judged by it: an accepted approximation).
    const folder = cwd ?? reads.find((read) => read.cwd)?.cwd ?? null;
    // With excluded folders, a slice that does not say its folder yet waits, offset unmoved (#3273:
    // a file whose first slice has no `cwd` at all stays unindexed, an accepted trade-off).
    if (folder === null && this.excludes.length > 0) return done;
    this.store.inTransaction(() => {
      for (const read of reads) {
        cwd = read.cwd ?? cwd;
        if (isExcludedCwd(cwd ?? folder, this.excludes)) continue;
        for (const edit of read.at ? read.edits : []) {
          this.store.recordEdit(file.claudeSessionId, edit, read.at as string);
        }
        if (!read.usage) continue;
        const { messageId, at, tokens } = read.usage;
        const keyOf = owner.projectPath ?? cwd ?? "";
        added += this.store.addEntry({
          id: messageId,
          session: file.claudeSessionId,
          at,
          day: this.day(Date.parse(at)),
          key: this.opts.projectKey(keyOf),
          model: tokens.model,
          origin: file.subagent ? "subagent" : owner.origin,
          speed: tokens.speed,
          input: tokens.input,
          output: tokens.output,
          cacheRead: tokens.cacheRead,
          cache5m: tokens.cacheWrite5m,
          cache1h: tokens.cacheWrite1h,
          cost: this.opts.cost?.(tokens) ?? null,
        });
      }
      this.store.saveFile(file.path, size, offset + end, cwd);
    });
    return { added, more: end > 0 && offset + end < size };
  }
}
