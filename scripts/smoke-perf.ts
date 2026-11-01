#!/usr/bin/env bun
/**
 * Performance smoke (phase 28): a `--runtime fake` daemon streams about 1,000 `message.delta`
 * events of one answer to a client while a second request is asked over and over. It checks that
 * the client got the whole text in a fraction of the frames (the daemon merges the words of a 25 ms
 * window), that every frame of text carries the current seq (no hole for the app to chase), that
 * the persisted events kept their order, and that the daemon stayed responsive: the p99 round
 * trip of `host.info` while it streamed is under 100 ms. It touches no network, no real `claude`,
 * `gh`, `az` or `~/.claude`.
 *
 * What it does not prove: a slow client. At this volume (about 100 KB) the socket buffers never
 * fill, so the hold-until-drain path is covered by the unit tests of `delta-coalescer.ts`.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, type EventEnvelope, parseServerMessage } from "@flightdeck/protocol";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

const guard = installClaudeGuard();
const home = installHomeGuard();
const checks = installCheckGuard();
assertCheckGuardActive(checks);
const clis = installCliGuard();
assertCliGuardActive(clis);

const TIMEOUT_MS = 30_000;
const ROOT = resolve(import.meta.dir, "..");
/** The fake runtime echoes the prompt in chunks of 4 characters, one every 10 ms. */
const PROMPT = "p".repeat(4000);
const DELTAS = Math.ceil(`Echo: ${PROMPT}`.length / 4);
/** At most this share of the runtime's deltas may arrive as frames (the window is 25 ms of 10 ms chunks). */
const MAX_FRAME_SHARE = 0.6;
const MAX_P99_MS = 100;

let step = "prepare";
const log = (msg: string) => console.log(`  · ${msg}`);

class Client {
  private ws!: WebSocket;
  private readonly acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  readonly events: EventEnvelope[] = [];
  closed = false;

  constructor(private readonly url: string) {}

  open(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "event") this.events.push(parsed);
      else if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
    });
    this.ws.addEventListener("close", () => {
      this.closed = true;
    });
    return new Promise((ok, fail) => {
      this.ws.addEventListener("open", () => ok(), { once: true });
      this.ws.addEventListener("error", () => fail(new Error("could not connect")), {
        once: true,
      });
    });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await withTimeout(ack, `ack of ${type}`);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
  }

  close(): Promise<void> {
    this.ws.close();
    return until(() => this.closed, "close the connection");
  }
}

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, fail) =>
      setTimeout(() => fail(new Error(`timeout: ${what}`)), TIMEOUT_MS),
    ),
  ]);
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(10);
  }
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

async function run(): Promise<void> {
  const work = realTempDir("flightdeck-smoke-perf-");
  const projectRoot = join(work, "projects");
  const project = join(projectRoot, "demo");
  mkdirSync(project, { recursive: true });
  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-perf",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projectRoot],
      runtime: "fake",
    }),
  );

  step = "start the daemon";
  const daemon = Bun.spawn(
    [
      process.execPath,
      "run",
      join(ROOT, "apps/daemon/src/bin.ts"),
      "start",
      "--config",
      configPath,
      "--runtime",
      "fake",
    ],
    // `env` explicitly: without it the daemon would get the environment from before the guards.
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );

  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "the daemon to announce its port");
    log(`daemon at ${url}`);

    step = "hello";
    const client = new Client(url);
    await client.open();
    await client.call("hello", { token, client: "smoke-perf" });

    step = "create the session";
    const { sessionId } = await client.call<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "hi",
      name: "perf",
    });
    await client.call("session.subscribe", { sessionId, sinceSeq: 0 });
    await until(() => client.events.some((e) => e.event.type === "turn.result"), "first turn");
    await until(
      () =>
        client.events.some((e) => e.event.type === "session.status" && e.event.status === "idle"),
      "the session to be idle",
    );
    const before = client.events.length;
    const lastPersisted = Math.max(
      ...client.events.filter((e) => e.event.type !== "message.delta").map((e) => e.seq),
    );

    step = "stream the answer";
    await client.call("session.send", { sessionId, text: PROMPT });
    const roundTrips: number[] = [];
    while (client.events.filter((e) => e.event.type === "turn.result").length < 2) {
      const started = performance.now();
      await client.call("host.info", {});
      roundTrips.push(performance.now() - started);
      await Bun.sleep(20);
      if (roundTrips.length > 4000) throw new Error("the answer never ended");
    }

    step = "check the frames";
    const fresh = client.events.slice(before);
    const frames = fresh.filter((e) => e.event.type === "message.delta");
    const text = frames.map((e) => (e.event.type === "message.delta" ? e.event.text : "")).join("");
    if (text !== `Echo: ${PROMPT}`) throw new Error("the text of the frames is not the answer");
    const share = frames.length / DELTAS;
    log(`${DELTAS} deltas of the runtime arrived as ${frames.length} frames (${share.toFixed(2)})`);
    if (share > MAX_FRAME_SHARE) {
      throw new Error(`too many frames: ${frames.length} of ${DELTAS} (limit ${MAX_FRAME_SHARE})`);
    }

    step = "check the seqs";
    let last = lastPersisted;
    for (const envelope of fresh) {
      if (envelope.event.type === "message.delta") {
        if (envelope.seq !== last)
          throw new Error(`a text frame at seq ${envelope.seq}, not ${last}`);
      } else {
        if (envelope.seq !== last + 1) throw new Error(`a hole before seq ${envelope.seq}`);
        last = envelope.seq;
      }
    }

    step = "check the responsiveness";
    roundTrips.sort((a, b) => a - b);
    const p99 = percentile(roundTrips, 0.99);
    log(`host.info while streaming: ${roundTrips.length} calls, p99 ${p99.toFixed(1)} ms`);
    if (p99 > MAX_P99_MS)
      throw new Error(`p99 of ${p99.toFixed(1)} ms over the ${MAX_P99_MS} ms limit`);

    step = "close the session";
    await client.call("session.close", { sessionId });
    await client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      // The SQLite files may still be locked on Windows for a moment; temp dir is fine to keep.
    }
  }
}

async function readListenUrl(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const match = buffer.match(/listening on (ws:\/\/\S+)/);
    if (match?.[1]) return match[1];
  }
  throw new Error(`the daemon exited without announcing its port: ${buffer}`);
}

try {
  await run();
  assertNoClaudeCalls(guard);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  assertNoCliCalls(clis);
  console.log("SMOKE PERF OK");
  process.exit(0);
} catch (error) {
  console.error(
    `SMOKE PERF FAIL at step "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
