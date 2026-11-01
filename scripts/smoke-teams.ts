#!/usr/bin/env bun
/**
 * Teams smoke: two `--runtime fake` daemons on different hosts, with a test "app" in the middle
 * (it carries the messages between the daemons and tells each what the other has). A session of
 * host A messages one of host B; a back and forth between two sessions is paused as a loop; and a
 * team of one coordinator and two workers does its cycle: the coordinator (this script, driving the
 * MCP tools with the coordinator's identity, since the fake runtime cannot reason) dispatches a task
 * to each worker, is told when each goes idle, checks their work itself, accepts the worker whose
 * check is green and refuses the one whose check fails.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type Ack,
  type MessageInfo,
  parseServerMessage,
  type ServerMessage,
  type TeamInfo,
} from "@flightdeck/protocol";
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

const TIMEOUT_MS = 20_000;
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

/** Polls an async check until it holds. */
async function until<T>(
  check: () => Promise<T | null | undefined | false>,
  what: string,
): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const found = await check();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timeout esperando ${what}`);
    await Bun.sleep(40);
  }
}

class Client {
  private ws!: WebSocket;
  private acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  readonly frames: ServerMessage[] = [];
  onFrame: (frame: ServerMessage) => void = () => {};

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
      else {
        this.frames.push(parsed);
        this.onFrame(parsed);
      }
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
    await this.call("hello", { token, client: "smoke-teams" });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await withTimeout(ack, `ack de ${type}`);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
  }

  close(): void {
    this.ws.close();
  }
}

/** Reads a stream to the end into `into`, so a daemon never blocks on a full pipe. */
async function drain(stream: ReadableStream<Uint8Array>, into: string[]): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) into.push(decoder.decode(chunk, { stream: true }));
}

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
}

/**
 * A stand-in for Claude Code: speaks MCP (JSON-RPC, one message per line) to `flightdeckd mcp` over
 * stdio, as the session whose id it is given, and only calls tools.
 */
class FakeClaude {
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private readonly waiting = new Map<number, (message: Record<string, unknown>) => void>();
  private seq = 0;
  private buffer = "";

  constructor(config: string, session: string) {
    const proc = Bun.spawn([process.execPath, "run", BIN, "mcp", "--config", config], {
      env: { ...process.env, FLIGHTDECK_SESSION: session },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    this.proc = proc;
    void (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
        this.buffer += decoder.decode(chunk, { stream: true });
        for (let end = this.buffer.indexOf("\n"); end >= 0; end = this.buffer.indexOf("\n")) {
          const line = this.buffer.slice(0, end).trim();
          this.buffer = this.buffer.slice(end + 1);
          if (!line) continue;
          const message = JSON.parse(line) as Record<string, unknown>;
          this.waiting.get(message.id as number)?.(message);
        }
      }
    })();
  }

  private send(message: Record<string, unknown>): void {
    const stdin = this.proc.stdin as { write(data: string): number; flush(): unknown };
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    stdin.flush();
  }

  private async request(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = ++this.seq;
    const answer = new Promise<Record<string, unknown>>((ok) => this.waiting.set(id, ok));
    this.send({ id, method, params });
    const message = await withTimeout(answer, `MCP ${method}`);
    if (message.error) throw new Error(`MCP ${method}: ${JSON.stringify(message.error)}`);
    return message.result as Record<string, unknown>;
  }

  async start(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "claude-falso", version: "1.0.0" },
    });
    this.send({ method: "notifications/initialized" });
  }

  /** What a tool answered, parsed; `error` when it failed. */
  async tool<T = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ data: T; error: string | null }> {
    const result = await this.request("tools/call", { name, arguments: args });
    const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");
    if (result.isError === true) return { data: {} as T, error: text };
    return { data: JSON.parse(text) as T, error: null };
  }

  async stop(): Promise<void> {
    this.proc.kill();
    await this.proc.exited;
  }
}

interface Host {
  name: string;
  repo: string;
  client: Client;
  configPath: string;
  projectId: string;
  proc: ReturnType<typeof Bun.spawn>;
  out: string[];
}

/** A daemon on `--runtime fake`, with a clone of the same repository as the other host has. */
async function startHost(work: string, name: string): Promise<Host> {
  const dir = join(work, name);
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "smoke@example.test");
  git(repo, "config", "user.name", "smoke");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
  writeFileSync(join(repo, "README.md"), "# app\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const token = crypto.randomUUID().replaceAll("-", "");
  const config = {
    hostName: name,
    port: 0,
    token,
    dataDir: join(dir, "data"),
    allowedRoots: [dir],
    runtime: "fake",
    hooks: { port: 0 },
    history: { roots: [join(dir, "sem-historico")] },
  };
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify(config));
  const proc = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    { env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  const out: string[] = [];
  void drain(proc.stdout, out);
  void drain(proc.stderr, []);
  const url = await withTimeout(
    (async () => {
      for (;;) {
        const found = out.join("").match(/listening on (ws:\/\/\S+)/)?.[1];
        if (found) return found;
        await Bun.sleep(20);
      }
    })(),
    `${name} anunciar a porta`,
  );
  const client = new Client(url);
  await client.open(token);
  // The MCP command finds the daemon by the port in its config; the daemon chose its own.
  const mcpConfig = join(dir, "mcp-config.json");
  writeFileSync(mcpConfig, JSON.stringify({ ...config, port: Number(new URL(url).port) }));
  const project = await client.call<{ id: string }>("project.add", { path: repo });
  log(`${name} em ${url}`);
  return { name, repo, client, configPath: mcpConfig, projectId: project.id, proc, out };
}

async function newSession(host: Host, name: string): Promise<string> {
  const { sessionId } = await host.client.call<{ sessionId: string }>("session.create", {
    cwd: host.repo,
    prompt: `sessão ${name}`,
    name,
  });
  await until(async () => {
    const list = await host.client.call<{ sessions: Array<{ id: string; status: string }> }>(
      "session.list",
      {},
    );
    return list.sessions.find((s) => s.id === sessionId)?.status === "idle";
  }, `${name} ociosa`);
  return sessionId;
}

async function run(work: string): Promise<void> {
  mkdirSync(work, { recursive: true });
  step = "subir os dois daemons";
  const a = await startHost(work, "host-a");
  const b = await startHost(work, "host-b");
  const claudes: FakeClaude[] = [];
  const hosts = [a, b];
  try {
    // The app in the middle: it carries what a daemon cannot deliver itself.
    const other = (host: Host) => (host === a ? b : a);
    const tell = (host: Host) => {
      host.client.onFrame = (frame) => {
        void (async () => {
          const peer = other(host);
          if (frame.type === "messages.relay") {
            const result = await peer.client.call<{ status: string; reason: string | null }>(
              "messages.relay",
              { message: frame.message },
            );
            await host.client.call("messages.relayed", { id: frame.message.id, ...result });
          }
          if (frame.type === "messages.updated" && frame.message.fromHost !== host.name) {
            // A message that came from the other host has a new state at its recipient.
            const m = frame.message;
            if (m.status === "delivered" || m.status === "refused") {
              await peer.client.call("messages.relayed", {
                id: m.id,
                status: m.status,
                reason: m.reason,
              });
            }
          }
        })().catch(() => {});
      };
    };
    for (const host of hosts) {
      tell(host);
      await host.client.call("messages.watch", {});
    }
    const sync = async () => {
      for (const host of hosts) {
        const directory = await host.client.call<{ host: string; sessions: unknown[] }>(
          "messages.directory",
          {},
        );
        await other(host).client.call("messages.peers", {
          host: directory.host,
          sessions: directory.sessions,
        });
      }
    };
    const timer = setInterval(() => void sync().catch(() => {}), 150);

    step = "criar as sessões";
    const a1 = await newSession(a, "a1");
    const a2 = await newSession(a, "a2");
    const b1 = await newSession(b, "b1");
    await sync();
    const claudeA1 = new FakeClaude(a.configPath, a1);
    const claudeA2 = new FakeClaude(a.configPath, a2);
    claudes.push(claudeA1, claudeA2);
    await Promise.all([claudeA1.start(), claudeA2.start()]);

    step = "list_sessions vê as sessões dos dois hosts";
    const seen = await claudeA1.tool<{ sessions: Array<{ address: string }> }>("list_sessions");
    const addresses = seen.data.sessions
      .map((s) => s.address)
      .sort((a, b) => (a < b ? -1 : Number(a > b)));
    if (!addresses.includes(`host-b/${b1}`) || !addresses.includes(`host-a/${a2}`)) {
      throw new Error(`list_sessions: ${JSON.stringify(addresses)}`);
    }
    log("a sessão do host A vê a do host B e a do próprio host");

    step = "uma mensagem do host A para o host B";
    const sent = await claudeA1.tool<{ resultado: string }>("send_to_session", {
      to: `host-b/${b1}`,
      text: "do host A para o host B",
    });
    if (sent.data.resultado !== "na fila")
      throw new Error(`devia sair na fila: ${JSON.stringify(sent)}`);
    const arrived = await until(async () => {
      const { messages } = await b.client.call<{ messages: MessageInfo[] }>("messages.list", {});
      return messages.find((m) => m.text === "do host A para o host B" && m.status === "delivered");
    }, "a mensagem chegar ao host B");
    if (arrived.fromHost !== "host-a") throw new Error("a mensagem devia vir do host A");
    await until(async () => {
      const { messages } = await a.client.call<{ messages: MessageInfo[] }>("messages.list", {});
      return messages.find((m) => m.id === arrived.id && m.status === "delivered");
    }, "o host A saber que foi entregue");
    log("a mensagem atravessou pelo app e foi entregue no host B");

    step = "um laço é pausado";
    let paused = "";
    for (let i = 0; i < 14 && !paused; i++) {
      const [from, to] = i % 2 === 0 ? [claudeA1, a2] : [claudeA2, a1];
      const result = await from.tool<{ resultado: string; motivo?: string }>("send_to_session", {
        to: `host-a/${to}`,
        text: `vai e volta ${i}`,
      });
      if (result.data.resultado === "recusada") paused = result.data.motivo ?? "";
    }
    if (!paused.includes("laço")) throw new Error(`o laço devia ser recusado: ${paused}`);
    const rules = await a.client.call<{ paused: string[] }>("messaging.rules.get", {});
    if (rules.paused.length !== 1)
      throw new Error(`o par devia estar pausado: ${JSON.stringify(rules)}`);
    const alert = await until(
      async () => a.client.frames.find((f) => f.type === "messaging.alert"),
      "o alerta do laço",
    );
    if (alert.type !== "messaging.alert") throw new Error("alerta inesperado");
    log("o vai e volta foi pausado e o app foi avisado");
    await a.client.call("messaging.rules.set", { policy: {}, unpause: rules.paused });

    step = "um time de uma coordenadora e duas executoras";
    const team = await a.client.call<TeamInfo>("teams.create", {
      projectId: a.projectId,
      goal: "Entregar duas tarefas pequenas.",
      workers: 2,
      name: "smoke",
      checks: ["git log --grep=fake: -1"],
    });
    const coordinator = team.coordinator as string;
    const workers = await until(async () => {
      const { teams } = await a.client.call<{ teams: TeamInfo[] }>("teams.list", {});
      const current = teams.find((t) => t.id === team.id);
      const list = current?.members.filter((m) => m.role === "worker") ?? [];
      return list.length === 2 && list.every((m) => m.sessionId && m.sessionState === "idle")
        ? list
        : null;
    }, "as executoras ociosas");
    const claudeC = new FakeClaude(a.configPath, coordinator);
    claudes.push(claudeC);
    await claudeC.start();
    const status = await claudeC.tool<{ members: Array<{ role: string }> }>("team_status", {
      team: team.id,
    });
    if (status.data.members.length !== 3) throw new Error("o time devia ter três membros");
    const outsider = await claudeA1.tool("team_status", { team: team.id });
    if (!outsider.error?.includes("não é do time"))
      throw new Error("quem não é do time não devia ver");
    log("o time nasceu com a coordenadora e duas executoras, e só os membros veem o estado");

    step = "a coordenadora despacha e assina o aviso de ocioso";
    const [first, second] = workers;
    const tasks = [
      [first, "Tarefa 1: crie o arquivo pedido. [commit]"],
      [second, "Tarefa 2: faça a outra parte e relate."],
    ] as const;
    for (const [worker, text] of tasks) {
      const dispatched = await claudeC.tool<{ resultado: string }>("send_to_session", {
        to: worker?.address,
        text,
      });
      if (dispatched.data.resultado === "recusada") throw new Error("o despacho foi recusado");
      await claudeC.tool("notify_when_idle", { session: worker?.address });
    }
    await until(async () => {
      const { messages } = await a.client.call<{ messages: MessageInfo[] }>("messages.list", {
        session: coordinator,
      });
      return messages.filter((m) => m.kind === "idle" && m.status === "delivered").length >= 2;
    }, "os dois avisos de ocioso");
    log("a coordenadora despachou uma tarefa a cada executora e recebeu os dois avisos de ocioso");

    step = "a coordenadora confere e aceita uma, recusa a outra";
    const verdicts: Array<{ name: string; green: boolean }> = [];
    for (const worker of [first, second]) {
      const card = await claudeC.tool<{ worktreePath: string }>("get_card", {
        cardId: worker?.cardId,
      });
      // The check the team runs: a green commit exists in the worker's own worktree.
      const found = git(card.data.worktreePath, "log", "--grep=fake:", "-1", "--format=%H");
      verdicts.push({ name: worker?.name ?? "", green: found !== "" });
      const reply = found
        ? `Aceito o seu commit ${found.slice(0, 8)}: o check passou.`
        : "Recusado: o check não achou nenhum commit seu. Corrija e feche um commit verde.";
      await claudeC.tool("send_to_session", { to: worker?.address, text: reply });
    }
    if (!verdicts[0]?.green || verdicts[1]?.green) {
      throw new Error(
        `a conferência devia aceitar a primeira e recusar a segunda: ${JSON.stringify(verdicts)}`,
      );
    }
    const { messages } = await a.client.call<{ messages: MessageInfo[] }>("messages.list", {
      team: team.id,
    });
    const aceito = messages.find((m) => m.text.startsWith("Aceito"));
    const recusado = messages.find((m) => m.text.startsWith("Recusado"));
    if (aceito?.toSession !== first?.sessionId || recusado?.toSession !== second?.sessionId) {
      throw new Error("o aceite e a recusa foram para as executoras erradas");
    }
    log("a coordenadora aceitou a executora de check verde e recusou a de check falhando");

    step = "pausar e retomar o time";
    await a.client.call("teams.pause", { team: team.id });
    const stops = await a.client.call<{ messages: MessageInfo[] }>("messages.list", {
      team: team.id,
    });
    if (
      stops.messages.filter((m) => m.kind === "system" && m.text.startsWith("STOP")).length !== 3
    ) {
      throw new Error("o STOP devia ir aos três membros");
    }
    const resumed = await a.client.call<TeamInfo>("teams.resume", { team: team.id });
    if (resumed.state !== "active") throw new Error("o time devia voltar a ativo");
    log("o time pausa com STOP para todos e retoma");
    clearInterval(timer);
  } finally {
    for (const claude of claudes) await claude.stop();
    for (const host of hosts) {
      host.client.close();
      host.proc.kill();
      await host.proc.exited;
    }
  }
}

const work = realTempDir("flightdeck-smoke-teams-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoNetwork(network);
  console.log("SMOKE TEAMS OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE TEAMS FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
