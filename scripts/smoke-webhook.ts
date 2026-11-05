#!/usr/bin/env bun
import { createHmac } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
/**
 * Webhook smoke (phase 30): a `--runtime fake` daemon and a local HTTP server that stands in for
 * Slack, Discord and a generic receiver. The app's webhook layer (targets, formatters, queue)
 * runs in this process and posts through the daemon's `webhook.send`, as the app does. It checks
 * the three payload shapes, the signature of the generic one, a 429 that is retried, a 404 that
 * stops the target, an address the daemon refuses, and that only the status comes back.
 */
import { type Ack, byCodeUnit, parseServerMessage } from "@flightdeck/protocol";
import { Webhooks } from "../apps/desktop/src/lib/webhooks.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
assertCliGuardActive(clis);

const TIMEOUT_MS = 20_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");
const SIGNING = "smoke-signing-secret";

let step = "prepare";
const log = (msg: string) => console.log(`  · ${msg}`);
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(what);
};

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, fail) =>
      setTimeout(() => fail(new Error(`timeout: ${what}`)), TIMEOUT_MS),
    ),
  ]);
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

class Client {
  private ws!: WebSocket;
  private readonly acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
    });
    await withTimeout(
      new Promise<void>((ok, fail) => {
        this.ws.addEventListener("open", () => ok(), { once: true });
        this.ws.addEventListener("error", () => fail(new Error("could not connect")), {
          once: true,
        });
      }),
      "connect",
    );
    await this.call("hello", { token, client: "smoke-webhook" });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await withTimeout(ack, `ack of ${type}`);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
  }

  close(): void {
    this.ws.close();
  }
}

interface Seen {
  path: string;
  headers: Headers;
  body: string;
}

async function run(work: string): Promise<void> {
  step = "start the receiver";
  const seen: Seen[] = [];
  let limited = 0;
  const receiver = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      seen.push({ path, headers: req.headers, body: await req.text() });
      if (path === "/limited" && limited++ === 0) {
        return new Response("slow down", { status: 429, headers: { "Retry-After": "1" } });
      }
      if (path === "/gone") return new Response("no such hook", { status: 404 });
      return new Response("ok", { status: 200 });
    },
  });
  const base = `http://127.0.0.1:${receiver.port}`;
  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  mkdirSync(work, { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-webhook",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [work],
      runtime: "fake",
    }),
  );
  step = "start the daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  try {
    const client = new Client(await withTimeout(readListenUrl(daemon.stdout), "daemon port"));
    await client.open(token);

    const store = new Map<string, string>();
    const vault = new Map<string, string>();
    const sleeps: number[] = [];
    const webhooks = new Webhooks({
      platform: {
        storage: {
          getItem: (k) => store.get(k) ?? null,
          setItem: (k, v) => void store.set(k, v),
        },
        vault: {
          get: async (id: string) => vault.get(id) ?? null,
          set: async (id: string, v: string) => void vault.set(id, v),
          delete: async (id: string) => void vault.delete(id),
        } as never,
      },
      send: async (request) => {
        const result = await client.call<{
          status: number | null;
          retryAfterMs: number | null;
          refused: string | null;
        }>("webhook.send", request);
        check(
          Object.keys(result).sort(byCodeUnit).join() === "refused,retryAfterMs,status",
          "the answer carries more than the status",
        );
        return {
          status: result.refused === null ? result.status : 400,
          retryAfterMs: result.retryAfterMs,
        };
      },
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0.5,
    });
    const target = (
      name: string,
      type: "slack" | "discord" | "generic",
      path: string,
      extra = {},
    ) =>
      webhooks.targets.add({
        name,
        type,
        url: `${base}${path}`,
        hostScope: null,
        kinds: ["needs_you"],
        clientId: null,
        ...extra,
      });
    const source = (id: string) => ({
      id,
      kind: "needs_you" as const,
      hostId: "h",
      hostName: "Pi",
      clientId: null,
      project: null,
      title: "Fix the build",
      detail: "Allow Bash?",
    });

    step = "three payload shapes";
    await target("slack", "slack", "/slack");
    await target("discord", "discord", "/discord");
    await target("generic", "generic", "/generic", { signingSecret: SIGNING });
    await webhooks.emit(source("e1"));
    await webhooks.idle();
    const at = (path: string) => seen.filter((s) => s.path === path);
    check(
      at("/slack").length === 1 && "text" in JSON.parse(at("/slack")[0]?.body ?? "{}"),
      "Slack payload",
    );
    check(
      JSON.parse(at("/discord")[0]?.body ?? "{}").embeds?.length === 1,
      "Discord payload has one embed",
    );
    log("Slack, Discord and generic payloads arrived");

    step = "signature";
    const generic = at("/generic")[0] as Seen;
    const stamp = generic.headers.get("X-Flightdeck-Timestamp");
    const expected = createHmac("sha256", SIGNING).update(`${stamp}.${generic.body}`).digest("hex");
    check(generic.headers.get("X-Flightdeck-Signature") === `sha256=${expected}`, "signature");
    check(generic.headers.get("X-Flightdeck-Delivery") === "e1", "delivery id");
    log("the generic signature verifies");

    step = "429 is retried";
    await target("limited", "slack", "/limited");
    await webhooks.emit(source("e2"));
    await webhooks.idle();
    check(
      at("/limited").length === 2,
      `expected 2 posts to /limited, got ${at("/limited").length}`,
    );
    check(
      sleeps.some((ms) => ms >= 1000),
      "Retry-After was not honored",
    );
    log("a 429 was retried after Retry-After");

    step = "404 stops the target";
    const gone = await target("gone", "slack", "/gone");
    await webhooks.emit(source("e3"));
    await webhooks.idle();
    await webhooks.emit(source("e4"));
    await webhooks.idle();
    check(at("/gone").length === 1, `expected 1 post to /gone, got ${at("/gone").length}`);
    check(webhooks.targets.list().find((t) => t.id === gone.id)?.status === "failing", "failing");
    log("a 404 stopped the target after one try");

    step = "private address refused";
    const inside = await webhooks.targets.add({
      name: "inside",
      type: "slack",
      url: `https://127.0.0.1:${receiver.port}/x`,
      hostScope: null,
      kinds: ["needs_you"],
      clientId: null,
    });
    const refused = await webhooks.test(inside.id);
    check(!refused.ok && refused.httpStatus === 400, "a private address was not refused");
    check(at("/x").length === 0, "the receiver was reached");
    log("an https address on this machine is refused");
    client.close();
    receiver.stop(true);
  } finally {
    daemon.kill();
    await daemon.exited;
  }
}

const work = realTempDir("flightdeck-smoke-webhook-");
let code = 1;
try {
  await run(work);
  step = "guards";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  console.log("SMOKE WEBHOOK OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE WEBHOOK FAIL at "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // A leftover temp dir is fine.
  }
}
process.exit(code);
