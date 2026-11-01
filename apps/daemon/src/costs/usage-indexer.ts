import type { Database } from "bun:sqlite";
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { normalizeCwd } from "../history/indexer.ts";
import { localDay } from "../quota/usage.ts";
import { ulid } from "../ulid.ts";

/** Where the usage of a message came from. */
export type UsageOrigin = "terminal" | "app" | "card" | "workflow" | "subagent" | "auto-approve";

/** What a message used, as the price table reads it. */
export interface UsageTokens {
  model: string;
  /** `standard` or `fast`. */
  speed: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

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

/** One transcript file: a session's own, or one of its subagents' (`<id>/subagents/*.jsonl`). */
interface TranscriptFile {
  path: string;
  claudeSessionId: string;
  subagent: boolean;
}

interface Usage {
  messageId: string;
  at: string;
  tokens: UsageTokens;
}

const sizeOf = (path: string) => {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
};

/** Whose session this is: the managed kind and, for cards and workflows, the project folder. */
interface Owner {
  origin: Exclude<UsageOrigin, "subagent">;
  projectPath: string | null;
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const str = (value: unknown) => (typeof value === "string" ? value : null);
const zeroTimer = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Error replies of the CLI itself: no model ran, nothing was used. */
const SYNTHETIC_MODEL = "<synthetic>";

/** Tools that write a file, and where their input names it (phase 11). */
const FILE_TOOLS: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

/** A tool call that wrote a file: its id (unique per call) and the path as written. */
interface FileEdit {
  toolUseId: string;
  path: string;
}

/** The file writes among a message's content blocks. */
function editsOf(content: unknown): FileEdit[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block: Record<string, unknown>) => {
    const field = block?.type === "tool_use" ? FILE_TOOLS[String(block.name)] : undefined;
    const input = block?.input as Record<string, unknown> | undefined;
    const toolUseId = str(block?.id);
    const path = field ? str(input?.[field]) : null;
    return toolUseId && path ? [{ toolUseId, path }] : [];
  });
}

interface ReadLine {
  cwd: string | null;
  at: string | null;
  usage: Usage | null;
  edits: FileEdit[];
}

/** The `cwd` of a transcript line, the usage of an assistant message and its file writes. */
function readLine(line: string): ReadLine {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(line);
  } catch {
    return { cwd: null, at: null, usage: null, edits: [] };
  }
  const cwd = str(value?.cwd);
  const message = value?.type === "assistant" ? (value.message as Record<string, unknown>) : null;
  const messageId = str(message?.id);
  const model = str(message?.model);
  const at = str(value.timestamp);
  const usage = message?.usage as Record<string, unknown> | undefined;
  const edits = editsOf(message?.content);
  if (!messageId || !model || model === SYNTHETIC_MODEL || !at || !usage) {
    return { cwd, at, usage: null, edits };
  }
  const split = usage.cache_creation as Record<string, unknown> | undefined;
  return {
    cwd,
    at,
    edits,
    usage: {
      messageId,
      at,
      tokens: {
        model,
        speed: str(usage.speed) ?? "standard",
        input: count(usage.input_tokens),
        output: count(usage.output_tokens),
        cacheRead: count(usage.cache_read_input_tokens),
        // Without the split, the whole cache write counts as the 5-minute one.
        cacheWrite5m: split
          ? count(split.ephemeral_5m_input_tokens)
          : count(usage.cache_creation_input_tokens),
        cacheWrite1h: split ? count(split.ephemeral_1h_input_tokens) : 0,
      },
    },
  };
}

/** A folder's entries; none when it does not exist (a session folder without `subagents/`). */
const entries = (dir: string) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/** A managed session's kind; the project folder of its card when it ran one. */
const OWNER = `SELECT
  (SELECT p.path FROM sessions s JOIN step_runs st ON st.session_id = s.id
     JOIN workflow_runs w ON w.id = st.run_id JOIN cards c ON c.id = w.card_id
     JOIN projects p ON p.id = c.project_id WHERE s.claude_session_id = $id LIMIT 1) AS workflow,
  (SELECT p.path FROM sessions s JOIN card_runs r ON r.session_id = s.id
     JOIN cards c ON c.id = r.card_id JOIN projects p ON p.id = c.project_id
     WHERE s.claude_session_id = $id LIMIT 1) AS card,
  EXISTS (SELECT 1 FROM sessions WHERE claude_session_id = $id) AS app`;

/**
 * The usage of every assistant message of the transcripts, read incrementally with offsets of
 * its own (`usage_files`). Claude Code writes one line per content block, each with the same
 * `message.id` and usage, so the id is the key: a message counts once, also when read again.
 */
export class UsageIndexer {
  private readonly db: Database;
  private readonly excludes: string[];
  private readonly day: (ms: number) => string;
  private load: InitialLoad = { state: "running", filesDone: 0, filesTotal: 0 };
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(readonly opts: UsageIndexerOptions) {
    this.db = opts.db;
    this.excludes = (opts.excludeCwds ?? []).map(normalizeCwd);
    this.day = opts.day ?? localDay;
  }

  /**
   * Phase 13: usage the daemon spends itself, with no transcript (the automatic approval's
   * queries run with persistSession false): origin `auto-approve`.
   */
  record(entry: { at: string; model: string; tokens: UsageTokens; projectPath: string }): void {
    const { tokens } = entry;
    this.db
      .query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model,
           origin, speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES (?, NULL, ?, ?, ?, ?, 'auto-approve', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `auto-approve-${ulid()}`,
        entry.at,
        this.day(Date.parse(entry.at)),
        this.opts.projectKey(entry.projectPath),
        entry.model,
        tokens.speed,
        tokens.input,
        tokens.output,
        tokens.cacheRead,
        tokens.cacheWrite5m,
        tokens.cacheWrite1h,
        this.opts.cost?.(tokens) ?? null,
      );
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
        await this.pass().catch((error: unknown) =>
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
    const files = this.files();
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
      added += this.indexFile(file, owner);
      if (first) this.load.filesDone++;
      await (this.opts.pause ?? zeroTimer)();
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

  /** Sessions read as the terminal's that a managed session claimed since (its id came later). */
  private reclassify(): void {
    const claimed = this.db
      .query<{ id: string }, []>(
        `SELECT DISTINCT claude_session_id AS id FROM usage_entries WHERE origin = 'terminal'
           AND claude_session_id IN (SELECT claude_session_id FROM sessions)`,
      )
      .all();
    for (const { id } of claimed) {
      const owner = this.owner(id);
      this.db
        .query(
          `UPDATE usage_entries SET
             origin = CASE WHEN origin = 'terminal' THEN $origin ELSE origin END,
             project_key = COALESCE($key, project_key)
           WHERE claude_session_id = $id`,
        )
        .run({
          id,
          origin: owner.origin,
          key: owner.projectPath === null ? null : this.opts.projectKey(owner.projectPath),
        });
    }
  }

  private owner(claudeSessionId: string): Owner {
    const row = this.db.query(OWNER).get({ id: claudeSessionId }) as {
      workflow: string | null;
      card: string | null;
      app: number;
    };
    if (row.workflow !== null) return { origin: "workflow", projectPath: row.workflow };
    if (row.card !== null) return { origin: "card", projectPath: row.card };
    return { origin: row.app ? "app" : "terminal", projectPath: null };
  }

  private files(): TranscriptFile[] {
    const files: TranscriptFile[] = [];
    for (const root of this.opts.roots) {
      for (const dir of entries(root)) {
        if (!dir.isDirectory()) continue;
        const project = join(root, dir.name);
        for (const item of entries(project)) {
          if (item.isFile() && item.name.endsWith(".jsonl")) {
            const path = join(project, item.name);
            files.push({ path, claudeSessionId: basename(item.name, ".jsonl"), subagent: false });
          } else if (item.isDirectory()) {
            const subagents = join(project, item.name, "subagents");
            for (const sub of entries(subagents)) {
              if (!sub.isFile() || !sub.name.endsWith(".jsonl")) continue;
              const path = join(subagents, sub.name);
              files.push({ path, claudeSessionId: item.name, subagent: true });
            }
          }
        }
      }
    }
    return files;
  }

  private isExcluded(cwd: string | null): boolean {
    if (!cwd) return false;
    const path = normalizeCwd(cwd);
    return this.excludes.some((ex) => path === ex || path.startsWith(`${ex}/`));
  }

  /** One more write of a file by a session; a tool call read again counts once. */
  private recordEdit(claudeSessionId: string, edit: FileEdit, at: string): void {
    const inserted = this.db
      .query(
        `INSERT OR IGNORE INTO session_file_edits (tool_use_id, claude_session_id, path, at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(edit.toolUseId, claudeSessionId, edit.path, at);
    if (inserted.changes === 0) return;
    this.db
      .query(
        `INSERT INTO session_files (claude_session_id, path, edits, first_at, last_at)
         VALUES ($id, $path, 1, $at, $at)
         ON CONFLICT (claude_session_id, path) DO UPDATE SET edits = edits + 1,
           first_at = MIN(first_at, $at), last_at = MAX(last_at, $at)`,
      )
      .run({ id: claudeSessionId, path: edit.path, at });
  }

  /** Reads what the file gained since the last pass (all of it when it shrank). */
  private indexFile(file: TranscriptFile, owner: Owner): number {
    // Gone since the listing (a session deleted meanwhile): nothing to read.
    const size = sizeOf(file.path);
    if (size === null) return 0;
    const row = this.db
      .query<{ offset: number; cwd: string | null }, [string]>(
        "SELECT offset, cwd FROM usage_files WHERE path = ?",
      )
      .get(file.path);
    const reset = size < (row?.offset ?? 0);
    const offset = reset ? 0 : (row?.offset ?? 0);
    if (!reset && size === offset) return 0;
    const chunk = Buffer.alloc(size - offset);
    const fd = openSync(file.path, "r");
    try {
      readSync(fd, chunk, 0, chunk.length, offset);
    } finally {
      closeSync(fd);
    }
    // Only complete lines: a last line without its newline is left for the next pass.
    const end = chunk.lastIndexOf(0x0a) + 1;
    let cwd = row?.cwd ?? null;
    let added = 0;
    const insert = this.db.query(
      `INSERT OR IGNORE INTO usage_entries (message_id, claude_session_id, at, day, project_key,
         model, origin, speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES ($id, $session, $at, $day, $key, $model, $origin, $speed, $input, $output,
         $cacheRead, $cache5m, $cache1h, $cost)`,
    );
    this.db.transaction(() => {
      for (const line of chunk.subarray(0, end).toString("utf8").split("\n")) {
        const read = readLine(line);
        cwd = read.cwd ?? cwd;
        if (this.isExcluded(cwd)) continue;
        for (const edit of read.at ? read.edits : []) {
          this.recordEdit(file.claudeSessionId, edit, read.at as string);
        }
        if (!read.usage) continue;
        const { messageId, at, tokens } = read.usage;
        const keyOf = owner.projectPath ?? cwd ?? "";
        added += insert.run({
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
        }).changes;
      }
      this.db
        .query(
          `INSERT INTO usage_files (path, size, offset, cwd) VALUES ($path, $size, $offset, $cwd)
           ON CONFLICT(path) DO UPDATE SET size = $size, offset = $offset, cwd = $cwd`,
        )
        .run({ path: file.path, size, offset: offset + end, cwd });
    })();
    return added;
  }
}
