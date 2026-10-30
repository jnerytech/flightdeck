#!/usr/bin/env bun
/**
 * Update smoke (phase 9): a local release server with daemon-latest.json and fake binaries
 * signed by the test key, a `--runtime fake` daemon checking it, `host.info.update` with the
 * new version, `daemon.update.apply` refused without a service, and a binary with one byte
 * changed refused by the verification, leaving nothing in `updates/`.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type Ack, PROTOCOL_VERSION, parseServerMessage } from "@flightdeck/protocol";
import { assertBinaryUntouched, installBinaryGuard } from "./test/binary-guard.ts";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { signForTest, TEST_PUBLIC_KEY } from "./test/minisign.ts";
import { assertNoNetwork, installNetworkGuard } from "./test/network-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

// The daemon inherits PATH and HOME: neither the real `claude` nor `~/.claude` (docs/TDD.md).
const guard = installClaudeGuard();
const home = installHomeGuard();
const binary = installBinaryGuard(dirname(home.realClaude));
const checks = installCheckGuard();
assertCheckGuardActive(checks);
const clis = installCliGuard();
assertCliGuardActive(clis);
const network = installNetworkGuard();
// The daemon may ask whether it runs as a service (read-only), never start or stop one.
const serviceGuard = join(realTempDir("fd-service-guard-"), "calls.log");
process.env.FLIGHTDECK_SERVICE_GUARD = serviceGuard;
const TIMEOUT_MS = 10_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, fail) =>
      setTimeout(() => fail(new Error(`timeout: ${what}`)), TIMEOUT_MS),
    ),
  ]);
}

class Client {
  private ws!: WebSocket;
  private acks = new Map<string, (ack: Ack) => void>();
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
        this.ws.addEventListener("error", () => fail(new Error("falha ao conectar")), {
          once: true,
        });
      }),
      "conectar",
    );
    const hello = await this.send("hello", {
      token,
      client: "smoke-update",
      protocolVersion: PROTOCOL_VERSION,
    });
    if (!hello.ok) throw new Error(`hello recusado: ${JSON.stringify(hello)}`);
  }

  send(type: string, payload: unknown): Promise<Ack> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    return withTimeout(ack, `ack de ${type}`);
  }

  close(): void {
    this.ws.close();
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
  throw new Error(`daemon saiu sem anunciar a porta: ${buffer}`);
}

const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/** A release server: the manifest and one binary per platform, signed by the test key. */
function releaseServer() {
  const good = new TextEncoder().encode("flightdeckd 9.9.9 (binário falso do smoke)");
  const state = { served: good };
  const server = Bun.serve({
    port: 0,
    fetch: (req: Request): Response => {
      const path = new URL(req.url).pathname;
      if (path === "/daemon-latest.json") return Response.json(manifest);
      return new Response(state.served);
    },
  });
  const asset = (name: string): { url: string; sha256: string; signature: string } => ({
    url: `http://127.0.0.1:${server.port}/bin/${name}`,
    sha256: sha256(good),
    signature: signForTest(good),
  });
  const manifest = {
    version: "9.9.9",
    protocol: PROTOCOL_VERSION,
    assets: {
      "windows-x64": asset("flightdeckd-windows-x64.exe"),
      "linux-x64": asset("flightdeckd-linux-x64"),
      "linux-arm64": asset("flightdeckd-linux-arm64"),
    },
  };
  return { server, state, good, url: `http://127.0.0.1:${server.port}/daemon-latest.json` };
}

async function run(work: string): Promise<void> {
  const release = releaseServer();
  const dataDir = join(work, "data");
  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-update",
      port: 0,
      token,
      dataDir,
      runtime: "fake",
      hooks: { port: 0 },
      updates: { manifestUrl: release.url },
    }),
  );

  step = "subir daemon";
  // `env` explicitly: without it the daemon would get the environment from before the guards.
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    {
      env: { ...process.env, FLIGHTDECK_TEST_PUBLIC_KEY: TEST_PUBLIC_KEY },
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "daemon anunciar a porta");
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "host.info.update com a versão do manifesto";
    const deadline = Date.now() + TIMEOUT_MS;
    let update: { available?: boolean; version?: string } | undefined;
    while (!update?.available && Date.now() < deadline) {
      const info = await client.send("host.info", {});
      update = info.ok ? (info.data as { update?: NonNullable<typeof update> }).update : undefined;
      if (!update?.available) await Bun.sleep(50);
    }
    if (update?.version !== "9.9.9") throw new Error(`update: ${JSON.stringify(update)}`);
    log(`atualização disponível: ${update.version}`);

    step = "aplicar sem serviço";
    const noService = await client.send("daemon.update.apply", { confirm: true });
    if (noService.ok || noService.error.code !== "update_needs_service") {
      throw new Error(`esperava update_needs_service, veio ${JSON.stringify(noService)}`);
    }
    log(noService.error.message);

    step = "binário alterado";
    const tampered = new Uint8Array(release.good);
    tampered[0] = (tampered[0] as number) ^ 1;
    release.state.served = tampered;
    const refused = await client.send("daemon.update.apply", { confirm: true });
    if (refused.ok || refused.error.code !== "update_verification_failed") {
      throw new Error(`esperava update_verification_failed, veio ${JSON.stringify(refused)}`);
    }
    const updates = join(dataDir, "updates");
    const left = existsSync(updates) ? readdirSync(updates) : [];
    if (left.length > 0) throw new Error(`ficaram arquivos em updates/: ${left.join(", ")}`);
    log(`${refused.error.message}; nada ficou em updates/`);
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
    release.server.stop(true);
  }
}

const work = realTempDir("flightdeck-smoke-update-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  assertNoCliCalls(clis);
  assertBinaryUntouched(binary);
  assertNoNetwork(network);
  // Only read-only service queries may have been attempted.
  const calls = existsSync(serviceGuard)
    ? readFileSync(serviceGuard, "utf8").trim().split("\n")
    : [];
  const changes = calls.filter((c) => !/\/Query|--user cat /.test(c));
  if (changes.length > 0) throw new Error(`controlador de serviço real chamado: ${changes}`);
  console.log("SMOKE UPDATE OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE UPDATE FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
