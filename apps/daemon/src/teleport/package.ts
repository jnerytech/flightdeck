/**
 * Issue #100, the source side of a teleport: an idle Claude Code session's transcript is copied
 * into a private package (a 0700 folder under the daemon's data dir, the file 0600), described by a
 * manifest and read back in chunks over the authenticated channel. The transcript is found only
 * where the history indexer recorded it, never at a path a client names; a link, a file outside the
 * history roots or an id that is not a UUID is never read. The manifest counts the lines that look
 * like secrets and names their kinds, never their text. A package goes when its time is up, when it
 * is cancelled and when the daemon starts.
 */

import { randomUUID } from "node:crypto";
import { mkdir, open, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  PermissionMode,
  SessionPersona,
  SessionStatus,
  TeleportChunk,
  TeleportManifest,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { isInside } from "../paths.ts";
import { readRegularSized } from "../read-regular.ts";

/** What a teleport reads of a session. */
export interface TeleportSession {
  id: string;
  cwd: string;
  status: SessionStatus;
  runtime?: "claude" | "opencode";
  permissionMode: PermissionMode;
  model: string | null;
  claudeSessionId: string | null;
  persona?: SessionPersona | null;
}

export interface TeleportDeps {
  /** The session, or a `session_not_found` refusal. */
  session(id: string): TeleportSession;
  /** The session belongs to a team: v1 moves one session at a time. */
  inTeam(id: string): boolean;
  /** The transcript file the history indexer recorded for a Claude session, or null. */
  transcriptOf(claudeSessionId: string): string | null;
  historyRoots: readonly string[];
  /** Where packages live (under the daemon's data dir). */
  dir: string;
  scan(text: string): string[];
  now(): number;
  newId(): string;
  timers: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(timer: unknown): void };
  log?(line: string): void;
  maxBytes?: number;
  chunkBytes?: number;
}

export type { TeleportChunk, TeleportManifest };

/** How long a package waits for the target to read it. */
export const TELEPORT_TTL_MS = 30 * 60_000;
/** The largest transcript a teleport takes. */
export const TELEPORT_MAX_BYTES = 64 * 1024 * 1024;
/** One chunk: well under a WebSocket frame once in base64. */
export const TELEPORT_CHUNK_BYTES = 128 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PART = "transcript";

interface Entry {
  manifest: TeleportManifest;
  timer: unknown;
}

const refuse = (code: "invalid_state" | "bad_request" | "not_found", reason: string) =>
  new FlightdeckError(code, reason.replaceAll("_", " "), reason);

/** The lines of a transcript that look like secrets, and the kinds found, in the order met. */
export function secretLines(
  text: string,
  scan: (text: string) => string[],
): TeleportManifest["secrets"] {
  const labels: string[] = [];
  let lines = 0;
  for (const line of text.split("\n")) {
    const found = line ? scan(line) : [];
    if (found.length === 0) continue;
    lines++;
    for (const label of found) if (!labels.includes(label)) labels.push(label);
  }
  return { lines, labels };
}

export class TeleportPackages {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Set<Promise<void>>();

  constructor(readonly deps: TeleportDeps) {}

  /** Packages left by an earlier run are gone, and the private folder is there, empty. */
  async start(): Promise<void> {
    await rm(this.deps.dir, { recursive: true, force: true });
    await mkdir(this.deps.dir, { recursive: true, mode: 0o700 });
  }

  async prepare(sessionId: string): Promise<TeleportManifest> {
    const session = this.deps.session(sessionId);
    if (session.status !== "idle" && session.status !== "ended") {
      throw refuse("invalid_state", "teleport_busy");
    }
    if (this.deps.inTeam(sessionId)) throw refuse("invalid_state", "teleport_team");
    if ((session.runtime ?? "claude") !== "claude") {
      throw refuse("invalid_state", "teleport_runtime");
    }
    const claudeId = session.claudeSessionId;
    if (!claudeId) throw refuse("not_found", "teleport_no_transcript");
    if (!UUID.test(claudeId)) throw refuse("bad_request", "teleport_unsafe_transcript");
    const file = this.deps.transcriptOf(claudeId);
    if (!file) throw refuse("not_found", "teleport_no_transcript");
    const text = await this.readTranscript(file, claudeId);
    const id = this.deps.newId();
    const folder = join(this.deps.dir, id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(join(folder, PART), text, { mode: 0o600 });
    const manifest: TeleportManifest = {
      id,
      sessionId,
      claudeSessionId: claudeId,
      cwd: session.cwd,
      model: session.model,
      permissionMode: session.permissionMode,
      persona: session.persona?.id ?? null,
      expiresAt: new Date(this.deps.now() + TELEPORT_TTL_MS).toISOString(),
      parts: [
        {
          name: PART,
          size: text.byteLength,
          sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
        },
      ],
      secrets: secretLines(text.toString("utf8"), this.deps.scan),
    };
    const timer = this.deps.timers.setTimeout(() => this.track(this.drop(id)), TELEPORT_TTL_MS);
    this.entries.set(id, { manifest, timer });
    this.deps.log?.(
      `teleport: package ${id} for session ${sessionId}, ${text.byteLength} bytes, ${manifest.secrets.lines} line(s) look like secrets`,
    );
    return manifest;
  }

  async read(id: string, part: string, offset: number): Promise<TeleportChunk> {
    const entry = this.entries.get(id);
    const size = entry?.manifest.parts.find((p) => p.name === part)?.size;
    if (size === undefined) throw refuse("not_found", "teleport_not_found");
    if (!Number.isInteger(offset) || offset < 0 || offset > size) {
      throw refuse("bad_request", "request_invalid");
    }
    const length = Math.min(this.deps.chunkBytes ?? TELEPORT_CHUNK_BYTES, size - offset);
    const buffer = Buffer.alloc(length);
    const handle = await open(join(this.deps.dir, id, PART), "r");
    try {
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      const next = offset + bytesRead;
      return { data: buffer.subarray(0, bytesRead).toString("base64"), next, eof: next >= size };
    } finally {
      await handle.close();
    }
  }

  async cancel(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) this.deps.timers.clearTimeout(entry.timer);
    await this.drop(id);
  }

  /** Waits for the packages being removed (a test, and the daemon's stop). */
  async idle(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  /** The transcript's bytes, read only when it is a regular file inside a history root. */
  private async readTranscript(file: string, claudeId: string): Promise<Buffer> {
    const max = this.deps.maxBytes ?? TELEPORT_MAX_BYTES;
    if (basename(file) !== `${claudeId}.jsonl`) {
      throw refuse("bad_request", "teleport_unsafe_transcript");
    }
    const folder = await realpath(dirname(file)).catch(() => null);
    const roots = await Promise.all(
      this.deps.historyRoots.map((r) => realpath(r).catch(() => null)),
    );
    if (!folder || !roots.some((root) => root !== null && isInside(root, folder))) {
      throw refuse("bad_request", "teleport_unsafe_transcript");
    }
    const read = await readRegularSized(join(folder, basename(file)), max);
    if (!read) throw refuse("bad_request", "teleport_unsafe_transcript");
    if (read.size > max) {
      throw new FlightdeckError("bad_request", "transcript too large", "teleport_too_large", {
        max,
      });
    }
    return read.data;
  }

  private async drop(id: string): Promise<void> {
    this.entries.delete(id);
    await rm(join(this.deps.dir, id), { recursive: true, force: true });
  }

  private track(work: Promise<void>): void {
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }
}

/** The daemon's parts a teleport reads (issue #100). */
export interface TeleportWiring {
  manager: { get(id: string): TeleportSession };
  names: { get(id: string): { team?: unknown } | null };
  indexer: { transcriptFile(claudeSessionId: string): string | null } | undefined;
  historyRoots: readonly string[];
  dataDir: string;
  scan(text: string): string[];
  log(line: string): void;
}

/** The real deps of the daemon's teleport packages. */
export function teleportDeps(wiring: TeleportWiring): TeleportDeps {
  return {
    session: (id) => wiring.manager.get(id),
    inTeam: (id) => Boolean(wiring.names.get(id)?.team),
    transcriptOf: (claudeSessionId) => wiring.indexer?.transcriptFile(claudeSessionId) ?? null,
    historyRoots: wiring.historyRoots,
    dir: join(wiring.dataDir, "teleport"),
    scan: wiring.scan,
    now: Date.now,
    newId: randomUUID,
    timers: globalThis,
    log: wiring.log,
  };
}
