import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TeleportManifest } from "@flightdeck/protocol";
import type { FlightdeckError } from "../src/errors.ts";
import { TeleportInbox, type TeleportInboxDeps } from "../src/teleport/receive.ts";
import { tempDir } from "./helpers.ts";

/**
 * Issue #100, slice 2a: the target side of a teleport receives a package. The app relays the
 * source's manifest, then each part in chunks, in order and never past the size the manifest
 * names; the parts are used only once each one is whole and matches its sha256.
 */
const ID = "0b6f5c2e-6f0a-4c39-9a51-7c4f1d2e3a4b";
const TRANSCRIPT = '{"type":"user","message":{"content":"fix the login"}}\n';
const CODE = "a git bundle's bytes";

const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const b64 = (text: string) => Buffer.from(text).toString("base64");

function manifest(over: Partial<TeleportManifest> = {}): TeleportManifest {
  return {
    id: "src-1",
    sessionId: "s1",
    claudeSessionId: ID,
    cwd: "/work/app",
    model: null,
    permissionMode: "default",
    persona: null,
    expiresAt: "2026-11-06T12:30:00.000Z",
    parts: [
      { name: "transcript", size: Buffer.byteLength(TRANSCRIPT), sha256: sha256(TRANSCRIPT) },
      { name: "code", size: Buffer.byteLength(CODE), sha256: sha256(CODE) },
    ],
    secrets: { lines: 0, labels: [] },
    git: {
      branch: "feature",
      head: "a".repeat(40),
      base: "origin/main",
      ref: "refs/x",
      ahead: 1,
      changed: 1,
    },
    ...over,
  };
}

const folders: string[] = [];
afterEach(async () => {
  for (const dir of folders.splice(0)) await rm(dir, { recursive: true, force: true });
});

function setup(options: { maxBytes?: number; chunkBytes?: number } = {}) {
  const base = tempDir("fd-teleport-in-");
  folders.push(base);
  const timers: Array<{ fn: () => void; ms: number; live: boolean; unref: boolean }> = [];
  let ids = 0;
  const deps: TeleportInboxDeps = {
    dir: join(base, "teleport-in"),
    now: () => Date.parse("2026-11-06T12:00:00.000Z"),
    newId: () => `in-${++ids}`,
    timers: {
      setTimeout: (fn, ms) => {
        const timer = { fn, ms, live: true, unref: false };
        timers.push(timer);
        return {
          timer,
          unref: () => {
            timer.unref = true;
          },
        };
      },
      clearTimeout: (handle) => {
        (handle as { timer: { live: boolean } }).timer.live = false;
      },
    },
    ...options,
  };
  return { inbox: new TeleportInbox(deps), deps, timers };
}

const reason = (run: () => Promise<unknown>) =>
  run().then(
    () => "no refusal",
    (error: unknown) => (error as FlightdeckError).reason ?? String(error),
  );

/** Every part written whole, in chunks of `size` bytes. */
async function send(inbox: TeleportInbox, id: string, parts: Record<string, string>, size = 8) {
  for (const [part, text] of Object.entries(parts)) {
    const bytes = Buffer.from(text);
    for (let offset = 0; offset < bytes.byteLength; offset += size) {
      await inbox.write(id, part, offset, bytes.subarray(offset, offset + size).toString("base64"));
    }
  }
}

const mode = (path: string) =>
  stat(path).then(
    (s) => s.mode & 0o777,
    () => "missing",
  );

describe("teleport-receive: the target takes a package in chunks (#100)", () => {
  test("parts sent in chunks are put back whole in a private folder and match the manifest", async () => {
    const { inbox, deps } = setup();
    await inbox.start();
    const { id } = await inbox.receive(manifest());
    await send(inbox, id, { transcript: TRANSCRIPT, code: CODE });
    const got = await inbox.received(id);
    const folder = join(deps.dir, id);
    expect([
      id,
      got.manifest.claudeSessionId,
      await readFile(got.transcript, "utf8").catch(() => "missing"),
      got.code === null ? "no code" : await readFile(got.code, "utf8").catch(() => "missing"),
      await mode(folder),
      await mode(join(folder, "transcript")),
      await mode(join(folder, "code")),
    ]).toEqual(["in-1", ID, TRANSCRIPT, CODE, 0o700, 0o600, 0o600]);
  });

  test("a chunk lands only where its part has reached, never past its size, never over the chunk limit", async () => {
    const { inbox } = setup({ chunkBytes: 8 });
    await inbox.start();
    const { id } = await inbox.receive(manifest());
    await inbox.write(id, "transcript", 0, b64(TRANSCRIPT.slice(0, 8)));
    const answers = [
      await reason(() => inbox.write("in-9", "transcript", 8, b64("x"))),
      await reason(() => inbox.write(id, "../transcript", 0, b64("x"))),
      await reason(() => inbox.write(id, "transcript", 0, b64("again"))),
      await reason(() => inbox.write(id, "transcript", 9, b64("gap"))),
      await reason(() => inbox.write(id, "transcript", 8, b64("123456789"))),
      await reason(() => inbox.write(id, "code", 0, b64(CODE.slice(0, 8)))),
    ];
    // The rest of the code part, from where the chunk above left it.
    for (let offset = 8; offset < CODE.length; offset += 8) {
      await inbox.write(id, "code", offset, b64(CODE.slice(offset, offset + 8)));
    }
    answers.push(await reason(() => inbox.write(id, "code", Buffer.byteLength(CODE), b64("more"))));
    expect(answers).toEqual([
      "teleport_not_found",
      "teleport_not_found",
      "request_invalid",
      "request_invalid",
      "request_invalid",
      "no refusal",
      "teleport_too_large",
    ]);
  });

  test("two chunks sent at once for the same place: one lands, the other is refused", async () => {
    const { inbox, deps } = setup();
    await inbox.start();
    const { id } = await inbox.receive(manifest());
    const both = await Promise.all([
      reason(() => inbox.write(id, "transcript", 0, b64("AAAA"))),
      reason(() => inbox.write(id, "transcript", 0, b64("BBBB"))),
    ]);
    expect([
      both.sort(),
      await readFile(join(deps.dir, id, "transcript"), "utf8").catch(() => "missing"),
    ]).toEqual([["no refusal", "request_invalid"], "AAAA"]);
  });

  test("a part that is short or does not match its sha256 is never used; the bad one goes", async () => {
    const { inbox, deps } = setup();
    await inbox.start();
    const short = await inbox.receive(manifest());
    await send(inbox, short.id, { transcript: TRANSCRIPT });
    const incomplete = await reason(() => inbox.received(short.id));
    const forged = await inbox.receive(
      manifest({
        claudeSessionId: "11111111-1111-4111-8111-111111111111",
        parts: [
          { name: "transcript", size: Buffer.byteLength(TRANSCRIPT), sha256: sha256("other") },
        ],
        git: undefined,
      }),
    );
    await send(inbox, forged.id, { transcript: TRANSCRIPT });
    expect([
      incomplete,
      await reason(() => inbox.received(forged.id)),
      await readdir(deps.dir).catch(() => ["no folder"]),
    ]).toEqual(["teleport_incomplete", "teleport_corrupt", [short.id]]);
  });

  test("a manifest with an unsafe id, a part over the limit, no transcript, a stray part or two of one is refused", async () => {
    const { inbox, deps } = setup({ maxBytes: 1000 });
    await inbox.start();
    const transcript = manifest().parts[0] as TeleportManifest["parts"][number];
    const code = manifest().parts[1] as TeleportManifest["parts"][number];
    const answers = [];
    for (const over of [
      { claudeSessionId: "../../.credentials" },
      { parts: [{ ...transcript, size: 1001 }] },
      { parts: [code] },
      { parts: [transcript, { ...code, name: "other" as "code" }] },
      { parts: [transcript, transcript] },
      { parts: [transcript, code], git: undefined },
      { parts: [{ ...transcript, sha256: "zz" }] },
    ]) {
      answers.push(await reason(() => inbox.receive(manifest({ git: undefined, ...over }))));
    }
    expect([answers, await readdir(deps.dir).catch(() => ["no folder"])]).toEqual([
      [
        "teleport_unsafe_transcript",
        "teleport_too_large",
        "request_invalid",
        "request_invalid",
        "request_invalid",
        "request_invalid",
        "request_invalid",
      ],
      [],
    ]);
  });
});

describe("teleport-receive: a received package does not outlive its time (#100)", () => {
  test("a session has one package under way, the host takes at most two, and each goes when its time is up", async () => {
    const { inbox, deps, timers } = setup();
    await inbox.start();
    const first = await inbox.receive(manifest());
    const again = await inbox.receive(manifest());
    const other = await inbox.receive(
      manifest({ claudeSessionId: "22222222-2222-4222-8222-222222222222" }),
    );
    const third = await reason(() =>
      inbox.receive(manifest({ claudeSessionId: "33333333-3333-4333-8333-333333333333" })),
    );
    const replaced = await reason(() => inbox.write(first.id, "transcript", 0, b64("x")));
    timers[1]?.fn();
    await inbox.idle();
    expect([
      third,
      replaced,
      timers.map((t) => [t.ms, t.live, t.unref]),
      await reason(() => inbox.write(again.id, "transcript", 0, b64("x"))),
      await readdir(deps.dir).catch(() => ["no folder"]),
    ]).toEqual([
      "teleport_too_many",
      "teleport_not_found",
      [
        [1_800_000, false, true],
        [1_800_000, true, true],
        [1_800_000, true, true],
      ],
      "teleport_not_found",
      [other.id],
    ]);
  });

  test("a chunk that waited its turn while its package went is refused, and writes nothing", async () => {
    const { inbox, deps } = setup();
    await inbox.start();
    const { id } = await inbox.receive(manifest());
    const late = reason(() => inbox.write(id, "transcript", 0, b64("late")));
    await inbox.abort(id);
    expect([await late, await readdir(deps.dir).catch(() => ["no folder"])]).toEqual([
      "teleport_not_found",
      [],
    ]);
  });

  test("an abort, the daemon's start and its stop remove what was received", async () => {
    const { inbox, deps, timers } = setup();
    await inbox.start();
    const { id } = await inbox.receive(manifest());
    await inbox.write(id, "transcript", 0, b64("part"));
    await inbox.abort(id);
    const afterAbort = await readdir(deps.dir).catch(() => ["no folder"]);
    await mkdir(join(deps.dir, "stale"), { recursive: true });
    await writeFile(join(deps.dir, "stale", "transcript"), "old");
    await new TeleportInbox(deps).start();
    const afterStart = await readdir(deps.dir).catch(() => ["no folder"]);
    await inbox.receive(manifest());
    await inbox.stop();
    expect([
      afterAbort,
      afterStart,
      await readdir(deps.dir).catch(() => ["no folder"]),
      timers.every((t) => !t.live),
      await reason(() => inbox.receive(manifest())),
    ]).toEqual([[], [], ["no folder"], true, "teleport_stopped"]);
  });
});
