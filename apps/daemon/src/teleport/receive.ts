/**
 * Issue #100, slice 2a: the target side of a teleport receives a package. The app relays the
 * source's manifest, then each part in chunks, in order: a chunk lands only at the offset the part
 * has reached, and never past the size the manifest names. The parts live in a private folder
 * (0700, the files 0600) under the daemon's data dir until they are imported, aborted or their
 * time is up; before anything uses them, each part's size and sha256 must match the manifest.
 */
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TeleportManifest } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { TELEPORT_CHUNK_BYTES, TELEPORT_MAX_LIVE, TELEPORT_TTL_MS } from "./package.ts";
import { TELEPORT_MAX_BYTES } from "./secrets.ts";

export interface TeleportInboxDeps {
  /** Where received packages live (under the daemon's data dir). */
  dir: string;
  now(): number;
  newId(): string;
  timers: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(timer: unknown): void };
  maxBytes?: number;
  chunkBytes?: number;
}

/** A received package whose every part is whole and matches its sha256. */
export interface TeleportReceived {
  manifest: TeleportManifest;
  transcript: string;
  code: string | null;
}

interface Entry {
  manifest: TeleportManifest;
  folder: string;
  written: Map<string, number>;
  timer: unknown;
  /** One chunk at a time: two chunks for the same place never both land. */
  queue: Promise<unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const PARTS = new Set(["transcript", "code"]);

const refuse = (
  code: "invalid_state" | "bad_request" | "not_found",
  reason: string,
  params?: Record<string, string | number>,
) => new FlightdeckError(code, reason.replaceAll("_", " "), reason, params);

/** The sha256 of a file, read in pieces. */
async function fileSha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const piece of Bun.file(path).stream()) hasher.update(piece);
  return hasher.digest("hex");
}

export class TeleportInbox {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Set<Promise<void>>();
  private stopped = false;
  /** One package is opened at a time: the caps are checked and taken with nothing in between. */
  private opening: Promise<unknown> = Promise.resolve();

  constructor(readonly deps: TeleportInboxDeps) {}

  /** Packages left by an earlier run are gone, and the private folder is there, empty. */
  async start(): Promise<void> {
    await rm(this.deps.dir, { recursive: true, force: true });
    await mkdir(this.deps.dir, { recursive: true, mode: 0o700 });
  }

  receive(manifest: TeleportManifest): Promise<{ id: string }> {
    const run = this.opening.then(() => this.open(manifest));
    this.opening = run.catch(() => {});
    return run;
  }

  private async open(manifest: TeleportManifest): Promise<{ id: string }> {
    if (this.stopped) throw refuse("invalid_state", "teleport_stopped");
    this.check(manifest);
    // A session has one package under way: a new one replaces the old.
    for (const [old, entry] of this.entries) {
      if (entry.manifest.claudeSessionId === manifest.claudeSessionId) await this.abort(old); // NOSONAR: one package at a time: each abort edits the entries this loop walks
    }
    if (this.entries.size >= TELEPORT_MAX_LIVE) throw refuse("invalid_state", "teleport_too_many");
    const id = this.deps.newId();
    const folder = join(this.deps.dir, id);
    await mkdir(this.deps.dir, { recursive: true, mode: 0o700 });
    await mkdir(folder, { mode: 0o700 });
    for (const part of manifest.parts) {
      await writeFile(join(folder, part.name), "", { mode: 0o600, flag: "wx" }); // NOSONAR: one file at a time: a failure stops before the next is created
    }
    const timer = this.deps.timers.setTimeout(() => this.track(this.drop(id)), TELEPORT_TTL_MS);
    // A package's timer never holds the daemon open.
    (timer as { unref?: () => void } | null)?.unref?.();
    const written = new Map(manifest.parts.map((part) => [part.name, 0]));
    this.entries.set(id, { manifest, folder, written, timer, queue: Promise.resolve() });
    return { id };
  }

  write(id: string, part: string, offset: number, data: string): Promise<{ written: number }> {
    const entry = this.entries.get(id);
    if (!entry?.written.has(part)) return Promise.reject(refuse("not_found", "teleport_not_found"));
    const run = entry.queue.then(() => this.append(id, part, offset, data));
    entry.queue = run.catch(() => {});
    return run;
  }

  /** The package's parts, once each one is whole and matches its sha256; a bad one goes. */
  async received(id: string): Promise<TeleportReceived> {
    const entry = this.entries.get(id);
    if (!entry) throw refuse("not_found", "teleport_not_found");
    await entry.queue;
    for (const part of entry.manifest.parts) {
      if (entry.written.get(part.name) !== part.size) {
        throw refuse("invalid_state", "teleport_incomplete");
      }
    }
    for (const part of entry.manifest.parts) {
      const sha = await fileSha256(join(entry.folder, part.name)); // NOSONAR: one part at a time, stopping at the first corrupt one before the rest is read
      if (sha !== part.sha256) {
        await this.abort(id); // NOSONAR: the first corrupt part ends the loop (the throw follows)
        throw refuse("bad_request", "teleport_corrupt");
      }
    }
    const code = entry.manifest.parts.some((part) => part.name === "code");
    return {
      manifest: entry.manifest,
      transcript: join(entry.folder, "transcript"),
      code: code ? join(entry.folder, "code") : null,
    };
  }

  /**
   * The package, whole and checked, taken out of the inbox for an import (slice 2b): its time no
   * longer runs, and no abort or replacement removes it; `release` removes its folder.
   */
  async claim(id: string): Promise<TeleportReceived & { release(): Promise<void> }> {
    const received = await this.received(id);
    const entry = this.entries.get(id);
    // Gone while it was being checked (aborted, replaced, its time ran out).
    if (!entry) throw refuse("not_found", "teleport_not_found");
    this.deps.timers.clearTimeout(entry.timer);
    this.entries.delete(id);
    return { ...received, release: () => rm(entry.folder, { recursive: true, force: true }) };
  }

  async abort(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) this.deps.timers.clearTimeout(entry.timer);
    await this.drop(id);
  }

  /** The daemon stops: every package goes now, and no timer is left. */
  async stop(): Promise<void> {
    this.stopped = true;
    // A package being opened finishes first: its folder is not made again after the removal.
    await this.opening;
    const writes = [...this.entries.values()].map((entry) => entry.queue);
    for (const entry of this.entries.values()) this.deps.timers.clearTimeout(entry.timer);
    this.entries.clear();
    await Promise.all(writes);
    await this.idle();
    await rm(this.deps.dir, { recursive: true, force: true });
  }

  /** Waits for the packages being removed (a test, and the daemon's stop). */
  async idle(): Promise<void> {
    await Promise.all(this.pending);
  }

  /** A manifest the target can take: a safe session id, the parts it knows once each, in size. */
  private check(manifest: TeleportManifest): void {
    if (!UUID.test(manifest.claudeSessionId)) {
      throw refuse("bad_request", "teleport_unsafe_transcript");
    }
    const names = manifest.parts.map((part) => part.name);
    const valid =
      names.includes("transcript") &&
      new Set(names).size === names.length &&
      names.every((name) => PARTS.has(name)) &&
      names.includes("code") === Boolean(manifest.git) &&
      manifest.parts.every((part) => SHA256.test(part.sha256) && Number.isSafeInteger(part.size));
    if (!valid) throw refuse("bad_request", "request_invalid");
    const max = this.deps.maxBytes ?? TELEPORT_MAX_BYTES;
    if (manifest.parts.some((part) => part.size < 0 || part.size > max)) {
      throw refuse("bad_request", "teleport_too_large", { max });
    }
  }

  private async append(
    id: string,
    part: string,
    offset: number,
    data: string,
  ): Promise<{ written: number }> {
    const entry = this.entries.get(id);
    const written = entry?.written.get(part);
    const size = entry?.manifest.parts.find((p) => p.name === part)?.size;
    // The package may go (aborted, its time ran out) while the chunk waited its turn.
    if (!entry || written === undefined || size === undefined) {
      throw refuse("not_found", "teleport_not_found");
    }
    const bytes = Buffer.from(data, "base64");
    if (offset !== written || bytes.byteLength > (this.deps.chunkBytes ?? TELEPORT_CHUNK_BYTES)) {
      throw refuse("bad_request", "request_invalid");
    }
    if (written + bytes.byteLength > size) {
      throw refuse("bad_request", "teleport_too_large", { max: size });
    }
    const handle = await open(join(entry.folder, part), "a");
    try {
      await handle.write(bytes);
    } finally {
      await handle.close();
    }
    entry.written.set(part, written + bytes.byteLength);
    return { written: written + bytes.byteLength };
  }

  private async drop(id: string): Promise<void> {
    const entry = this.entries.get(id);
    // Not in the inbox: unknown, gone already, or claimed by an import that removes it itself.
    if (!entry) return;
    this.entries.delete(id);
    // A chunk already being written ends first: no file is opened while its folder goes.
    await entry.queue;
    await rm(join(this.deps.dir, id), { recursive: true, force: true });
  }

  private track(work: Promise<void>): void {
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }
}
