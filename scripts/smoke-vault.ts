#!/usr/bin/env bun
/**
 * Vault smoke: a test "app" with an in-memory vault delivers a `token` to a `--runtime fake`
 * daemon, which uses it in an echo action (answering only its SHA-256). The value is gone from
 * the daemon's memory when it is used and when its deadline passes, and neither the daemon's
 * logs, nor its database and files, nor this smoke's own output contain it.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage, type ServerMessage } from "@flightdeck/protocol";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { assertNoNetwork, installNetworkGuard } from "./test/network-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
const network = installNetworkGuard();
assertCliGuardActive(clis);

const TIMEOUT_MS = 15_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");

let step = "preparar";
/** Everything this smoke prints: it is searched for the secret too. */
const printed: string[] = [];
const log = (msg: string) => {
  printed.push(msg);
  console.log(`  · ${msg}`);
};

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, fail) =>
      setTimeout(() => fail(new Error(`timeout: ${what}`)), TIMEOUT_MS),
    ),
  ]);
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** The app's side: a vault in memory, the way the real one is in the OS keyring. */
class AppVault {
  private readonly secrets = new Map<string, string>();
  set(id: string, value: string): void {
    this.secrets.set(id, value);
  }
  get(id: string): string {
    const value = this.secrets.get(id);
    if (value === undefined) throw new Error(`segredo ${id} não existe no cofre do app`);
    return value;
  }
}

class Client {
  private ws!: WebSocket;
  private acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  frames: ServerMessage[] = [];

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
      else this.frames.push(parsed);
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
    await this.call("hello", { token, client: "smoke-vault" });
  }

  /** The ack as it came, success or failure. */
  async request(type: string, payload: unknown): Promise<Ack> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    return withTimeout(ack, `ack de ${type}`);
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const result = await this.request(type, payload);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
  }

  close(): void {
    this.ws.close();
  }
}

/** Reads a stream to the end into `into`, so the daemon never blocks on a full pipe. */
async function drain(stream: ReadableStream<Uint8Array>, into: string[]): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) into.push(decoder.decode(chunk, { stream: true }));
}

function listenUrl(output: string[]): string | null {
  return output.join("").match(/listening on (ws:\/\/\S+)/)?.[1] ?? null;
}

function filesOf(folder: string): Buffer[] {
  const found: Buffer[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...filesOf(path));
    else found.push(readFileSync(path));
  }
  return found;
}

async function run(work: string): Promise<void> {
  mkdirSync(work, { recursive: true });
  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  const dataDir = join(work, "data");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-vault",
      port: 0,
      token,
      dataDir,
      allowedRoots: [],
      runtime: "fake",
      hooks: { port: 0 },
      history: { roots: [join(work, "sem-historico")] },
    }),
  );
  const secret = `ghp_${crypto.randomUUID().replaceAll("-", "")}_SEGREDO-DO-SMOKE`;
  const app = new AppVault();
  app.set("tok-github", secret);

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    // `env` explicitly: without it the daemon would get the environment from before the guards.
    { env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  const out: string[] = [];
  const err: string[] = [];
  void drain(daemon.stdout, out);
  void drain(daemon.stderr, err);
  try {
    const url = await withTimeout(
      (async () => {
        for (;;) {
          const found = listenUrl(out);
          if (found) return found;
          await Bun.sleep(20);
        }
      })(),
      "daemon anunciar a porta",
    );
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "entregar e usar";
    const deadline = Date.now() + 30_000;
    const ack = await client.call<{ expiresAt: number }>("vault.deliver", {
      secretId: "tok-github",
      value: app.get("tok-github"),
      purpose: "acao",
      expiresAt: deadline,
    });
    if (ack.expiresAt !== deadline) throw new Error(`prazo ${ack.expiresAt}`);
    const used = await client.call<{ result: string }>("vault.use", {
      secretId: "tok-github",
      purpose: "acao",
      action: "echo",
    });
    if (used.result !== sha(secret)) throw new Error("o eco não é o SHA-256 do valor entregue");
    log("o token foi entregue e usado na ação de eco (só o SHA-256 voltou)");
    const frame = await withTimeout(
      (async () => {
        for (;;) {
          const found = client.frames.find((f) => f.type === "vault.used");
          if (found) return found;
          await Bun.sleep(20);
        }
      })(),
      "frame vault.used",
    );
    if (
      frame.type !== "vault.used" ||
      frame.requester !== "you" ||
      frame.secretId !== "tok-github"
    ) {
      throw new Error(`vault.used inesperado: ${JSON.stringify(frame)}`);
    }

    step = "o valor sai da memória no uso";
    const second = await client.request("vault.use", {
      secretId: "tok-github",
      purpose: "acao",
      action: "echo",
    });
    if (second.ok) throw new Error("o segundo uso funcionou: o valor continuava na memória");
    log(`depois do uso o daemon não tem mais o valor: ${second.error.message}`);

    step = "o valor sai da memória no prazo";
    await client.call("vault.deliver", {
      secretId: "tok-github",
      value: app.get("tok-github"),
      purpose: "acao",
      expiresAt: Date.now() + 300,
    });
    await Bun.sleep(900);
    const late = await client.request("vault.use", {
      secretId: "tok-github",
      purpose: "acao",
      action: "echo",
    });
    if (late.ok) throw new Error("o valor sobreviveu ao prazo");
    log("passado o prazo o valor também não está mais com o daemon");

    step = "o daemon com outra finalidade ou ação não gasta o valor";
    await client.call("vault.deliver", {
      secretId: "tok-github",
      value: app.get("tok-github"),
      purpose: "acao",
      expiresAt: Date.now() + 30_000,
    });
    const wrong = await client.request("vault.use", {
      secretId: "tok-github",
      purpose: "ssh",
      action: "echo",
    });
    if (wrong.ok) throw new Error("o uso com outra finalidade funcionou");
    const leak = await client.request("vault.use", {
      secretId: "tok-github",
      purpose: "acao",
      action: "lerValor",
    });
    if (leak.ok) throw new Error("uma ação inexistente funcionou");
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
  }

  step = "procurar o valor nos logs e no banco";
  // The daemon is stopped, so its files are complete.
  const haystacks = [
    ...filesOf(dataDir),
    Buffer.from(out.join("")),
    Buffer.from(err.join("")),
    Buffer.from(printed.join("\n")),
  ];
  for (const needle of [
    secret,
    Buffer.from(secret).toString("base64"),
    Buffer.from(secret).toString("hex"),
  ]) {
    if (haystacks.some((hay) => hay.includes(needle))) {
      throw new Error("o valor do segredo apareceu nos logs, no banco ou na saída do smoke");
    }
  }
  log(`${filesOf(dataDir).length} arquivos do daemon, os logs e esta saída sem o valor`);
}

const work = realTempDir("flightdeck-smoke-vault-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoNetwork(network);
  console.log("SMOKE VAULT OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE VAULT FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
