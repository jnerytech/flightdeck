import type { Database } from "bun:sqlite";
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { normalizeCwd } from "../history/indexer.ts";
import { localDay } from "../quota/usage.ts";

/** Where the usage of a message came from. */
export type UsageOrigin = "terminal" | "app" | "card" | "workflow" | "subagent";

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
  /** Awaited between files of a pass, so the daemon keeps answering. */
  pause?: () => Promise<void>;
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

/** Whose session this is: the managed kind and, for cards and workflows, the project folder. */
interface Owner {
  origin: Exclude<UsageOrigin, "subagent">;
  projectPath: string | null;
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const str = (value: unknown) => (typeof value === "string" ? value : null);

/** Error replies of the CLI itself: no model ran, nothing was used. */
const SYNTHETIC_MODEL = "<synthetic>";

/** The `cwd` of a transcript line and the usage of an assistant message, when it has one. */
function readLine(line: string): { cwd: string | null; usage: Usage | null } {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(line);
  } catch {
    return { cwd: null, usage: null };
  }
  const cwd = str(value?.cwd);
  const message = value?.type === "assistant" ? (value.message as Record<string, unknown>) : null;
  const messageId = str(message?.id);
  const model = str(message?.model);
  const at = str(value.timestamp);
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (!messageId || !model || model === SYNTHETIC_MODEL || !at || !usage) {
    return { cwd, usage: null };
  }
  const split = usage.cache_creation as Record<string, unknown> | undefined;
  return {
    cwd,
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

  constructor(readonly opts: UsageIndexerOptions) {
    this.db = opts.db;
    this.excludes = (opts.excludeCwds ?? []).map(normalizeCwd);
    this.day = opts.day ?? localDay;
  }

  /** One pass over every transcript and subagent transcript; returns the entries added. */
  async pass(): Promise<number> {
    this.reclassify();
    const owners = new Map<string, Owner>();
    let added = 0;
    for (const file of this.files()) {
      let owner = owners.get(file.claudeSessionId);
      if (!owner) {
        owner = this.owner(file.claudeSessionId);
        owners.set(file.claudeSessionId, owner);
      }
      added += this.indexFile(file, owner);
      await this.opts.pause?.();
    }
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

  /** Reads what the file gained since the last pass (all of it when it shrank). */
  private indexFile(file: TranscriptFile, owner: Owner): number {
    const size = statSync(file.path).size;
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
        if (!read.usage || this.isExcluded(cwd)) continue;
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
