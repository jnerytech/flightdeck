import type { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";

/** Fake `~/.claude/projects`: one directory per project, built from hand-written lines. */
export function projectsRoot(): string {
  const root = join(tempDir("fd-history-"), "projects");
  mkdirSync(root);
  return root;
}

interface LineOpts {
  uuid: string;
  text: string;
  cwd: string;
  ts?: string;
  sessionId?: string;
}

export function userLine({ uuid, text, cwd, ts = "2026-09-01T10:00:00.000Z" }: LineOpts): string {
  return JSON.stringify({
    parentUuid: null,
    cwd,
    type: "user",
    message: { role: "user", content: text },
    uuid,
    timestamp: ts,
  });
}

export function assistantLine({
  uuid,
  text,
  cwd,
  ts = "2026-09-01T10:00:01.000Z",
}: LineOpts): string {
  return JSON.stringify({
    cwd,
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    uuid,
    timestamp: ts,
  });
}

export function summaryLine(summary: string, leafUuid: string): string {
  return JSON.stringify({ type: "summary", summary, leafUuid });
}

/** Writes `<root>/<dir>/<id>.jsonl` with one line per entry, each ending in `\n`. */
export function writeTranscript(root: string, dir: string, id: string, lines: string[]): string {
  mkdirSync(join(root, dir), { recursive: true });
  const path = join(root, dir, `${id}.jsonl`);
  writeFileSync(path, lines.map((l) => `${l}\n`).join(""));
  return path;
}

export function appendRaw(path: string, text: string): void {
  appendFileSync(path, text);
}

/** Stored messages of a session, in file order. */
export function storedMessages(db: Database, claudeSessionId: string) {
  return db
    .query(
      "SELECT uuid, role, kind, text FROM history_messages WHERE claude_session_id = ? ORDER BY rowid",
    )
    .all(claudeSessionId) as Array<{ uuid: string; role: string; kind: string; text: string }>;
}

export function fileRow(db: Database, path: string) {
  return db
    .query("SELECT size, offset, parse_errors FROM history_files WHERE path = ?")
    .get(path) as { size: number; offset: number; parse_errors: number } | null;
}

/** Protocol client that keeps every non-ack frame (events, `history.changed`). */
export class FrameClient {
  readonly ws: WebSocket;
  readonly frames: Array<Record<string, unknown>> = [];
  private readonly acks = new Map<string, (ack: Record<string, unknown>) => void>();
  private nextId = 0;
  private readonly opened: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve) => this.ws.addEventListener("open", () => resolve()));
    this.ws.addEventListener("message", (msg) => {
      const frame = JSON.parse(String(msg.data)) as Record<string, unknown>;
      if (frame.type === "ack") this.acks.get(String(frame.id))?.(frame);
      else this.frames.push(frame);
    });
  }

  /** Sends a command and resolves with its ack (`{ ok, data }` or `{ ok: false, error }`). */
  async request(type: string, payload: unknown): Promise<Record<string, unknown>> {
    await this.opened;
    const id = String(++this.nextId);
    const ack = new Promise<Record<string, unknown>>((resolve) => this.acks.set(id, resolve));
    this.ws.send(JSON.stringify({ id, type, payload }));
    return ack;
  }

  /** `data` of a successful ack; `null` when the command failed. */
  async data<T>(type: string, payload: unknown): Promise<T | null> {
    const ack = await this.request(type, payload);
    return ack.ok === true ? (ack.data as T) : null;
  }

  close(): void {
    this.ws.close();
  }
}
