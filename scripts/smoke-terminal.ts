#!/usr/bin/env bun
/**
 * Terminal smoke: a `--runtime fake` daemon with the terminal on and a real PTY running a fixed,
 * harmless command (bun, printing its pid and the pid of a child it started, then echoing the
 * lines it reads). A client opens the terminal, follows its output, writes a line and sees it
 * echoed, resizes (acked, output keeps flowing), disconnects, reconnects, and `terminal.attach`
 * returns the scrollback; then `terminal.close` with kill ends the process and its child, and
 * both are gone within a timeout. No shell is ever started, and nothing here reaches the real
 * `claude`, `gh`, `az` or `~/.claude`.
 */
import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage, type TerminalAttachResult } from "@flightdeck/protocol";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

// The daemon gets this environment: neither the real `claude`, `gh` and `az` nor `~/.claude`.
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
const checks = installCheckGuard();
assertCliGuardActive(clis);
assertCheckGuardActive(checks);

const TIMEOUT_MS = 20_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");

/** The whole of what runs in the terminal: a fixed script, nothing a user typed. */
const SCRIPT = `
const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log("READY pid=" + process.pid + " child=" + child.pid);
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const end = buffer.search(/[\\r\\n]/);
    if (end < 0) break;
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (line) console.log("ECHO:" + line);
  }
});
setInterval(() => {}, 1000);
`;

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

async function until<T>(check: () => T | null | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(50);
  }
}

class Client {
  private ws!: WebSocket;
  private acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  /** What arrived as `terminal.data`, decoded. */
  output = "";
  resyncs = 0;
  exited: number | null = null;

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
      else if (parsed.type === "terminal.data")
        this.output += Buffer.from(parsed.data, "base64").toString("utf8");
      else if (parsed.type === "terminal.resync") this.resyncs++;
      else if (parsed.type === "terminal.exited") this.exited = parsed.exitCode;
    });
    await new Promise<void>((ok, fail) => {
      this.ws.addEventListener("open", () => ok(), { once: true });
      this.ws.addEventListener("error", () => fail(new Error("falha ao conectar")), {
        once: true,
      });
    });
    await this.call("hello", { token, client: "smoke-terminal" });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await Promise.race([
      ack,
      Bun.sleep(TIMEOUT_MS).then(() => {
        throw new Error(`timeout: ack de ${type}`);
      }),
    ]);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
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

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function run(work: string): Promise<void> {
  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-terminal",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [work],
      runtime: "fake",
      hooks: { port: 0 },
      terminal: { enabled: true },
    }),
  );

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  const pids: number[] = [];
  try {
    const url = await readListenUrl(daemon.stdout);
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "abrir o terminal";
    const info = await client.call<{ terminalId: string; command: string }>("terminal.open", {
      cwd: work,
      command: [process.execPath, "-e", SCRIPT],
      cols: 100,
      rows: 30,
    });
    const terminalId = info.terminalId;
    const attached = await client.call<TerminalAttachResult>("terminal.attach", { terminalId });
    log(`terminal ${terminalId} aberto e seguido (${attached.cols}x${attached.rows})`);

    step = "saída do processo";
    const seen = (text: string) => client.output.includes(text);
    const first = await until(
      () => client.output.match(/READY pid=(\d+) child=(\d+)/),
      "a primeira linha do processo",
    );
    pids.push(Number(first[1]), Number(first[2]));
    log(`processo ${pids[0]} e filho ${pids[1]} rodando`);

    step = "escrever e ver o eco";
    await client.call("terminal.write", { terminalId, data: "primeiro\r" });
    await until(() => seen("ECHO:primeiro"), "o eco da primeira linha");
    log("a linha escrita voltou pelo terminal");

    step = "redimensionar";
    await client.call("terminal.resize", { terminalId, cols: 120, rows: 40 });
    await client.call("terminal.write", { terminalId, data: "depois-do-resize\r" });
    await until(() => seen("ECHO:depois-do-resize"), "saída depois do resize");
    log("resize confirmado e a saída continua");

    step = "desconectar e reconectar";
    client.close();
    const again = new Client(url);
    await again.open(token);
    const listed = await again.call<{ terminals: Array<{ terminalId: string; exitCode: null }> }>(
      "terminal.list",
      {},
    );
    if (!listed.terminals.some((t) => t.terminalId === terminalId && t.exitCode === null)) {
      throw new Error(`o terminal devia seguir vivo: ${JSON.stringify(listed)}`);
    }
    const back = await again.call<TerminalAttachResult>("terminal.attach", { terminalId });
    const scrollback = Buffer.from(back.scrollback, "base64").toString("utf8");
    if (!scrollback.includes("READY pid=") || !scrollback.includes("ECHO:primeiro")) {
      throw new Error(`o scrollback devia ter o que já saiu: ${scrollback.slice(0, 200)}`);
    }
    log("o terminal sobreviveu à conexão e o attach devolveu o scrollback");
    await again.call("terminal.write", { terminalId, data: "reconectado\r" });
    await until(() => again.output.includes("ECHO:reconectado"), "saída depois de reconectar");
    log("a saída nova chega na conexão nova");

    step = "kill derruba o processo e o filho";
    await again.call("terminal.close", { terminalId, kill: true });
    await until(() => pids.every((pid) => !alive(pid)), "o processo e o filho encerrarem");
    log("o processo e o filho do terminal não existem mais");
    if (client.resyncs + again.resyncs !== 0) {
      throw new Error("um cliente rápido não devia receber terminal.resync");
    }
    again.close();
  } finally {
    // Never leave the fixed command behind, even when a step failed.
    for (const pid of pids) {
      try {
        process.kill(pid);
      } catch {
        // already gone
      }
    }
    daemon.kill();
    await daemon.exited;
  }
}

// The real path: on the GitHub runner TEMP is an 8.3 name that the daemon resolves.
const work = realTempDir("flightdeck-smoke-terminal-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE TERMINAL OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE TERMINAL FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
