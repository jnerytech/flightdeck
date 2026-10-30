#!/usr/bin/env bun
/**
 * Actions smoke: an echo action prints its own token; a stand-in for Claude calls it through the
 * MCP of a `--runtime fake` daemon (a real `flightdeckd mcp` over stdio) and gets `•••(name)` in
 * place of the value. An action with a parameter off its pattern is refused, and a
 * `run_with_secret` the "user" does not approve does not run. The test "app" holds the vault, asks
 * nothing of Claude and delivers a secret only for the request the daemon makes. At the end the
 * value, in no form, is in the daemon's files, its logs, what the MCP client received or this
 * smoke's output.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const TIMEOUT_MS = 20_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");

let step = "preparar";
/** Everything this smoke prints and receives as Claude: it is searched for the secret too. */
const seen: string[] = [];
const log = (msg: string) => {
  seen.push(msg);
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

type Request = Extract<ServerMessage, { type: "vault.request" }>;

class App {
  private ws!: WebSocket;
  private acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  /** What the user would do with the next requests. */
  mode: "approve" | "deny" = "approve";
  readonly requests: Request[] = [];

  constructor(
    private readonly url: string,
    private readonly vault: AppVault,
  ) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
      else if (parsed.type === "vault.request") void this.answer(parsed);
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
    await this.call("hello", { token, client: "smoke-actions" });
    await this.call("vault.watch", {});
  }

  /** The user's answer to a request the daemon made. */
  private async answer(request: Request): Promise<void> {
    this.requests.push(request);
    if (this.mode === "deny") {
      await this.call("vault.deny", { requestId: request.requestId });
      return;
    }
    await this.call("vault.deliver", {
      secretId: request.secretId,
      value: this.vault.get(request.secretId),
      purpose: request.purpose,
      expiresAt: Date.now() + 30_000,
      requester: request.requester,
    });
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

/** Reads a stream to the end into `into`, so the daemon never blocks on a full pipe. */
async function drain(stream: ReadableStream<Uint8Array>, into: string[]): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) into.push(decoder.decode(chunk, { stream: true }));
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

/**
 * A stand-in for Claude Code: speaks MCP (JSON-RPC, one message per line) to `flightdeckd mcp`
 * over stdio, the way the real one does, and only calls tools.
 */
class FakeClaude {
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private readonly waiting = new Map<number, (message: Record<string, unknown>) => void>();
  private seq = 0;
  private buffer = "";

  constructor(args: string[]) {
    const proc = Bun.spawn([process.execPath, "run", BIN, ...args], {
      env: process.env,
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
    (this.proc.stdin as { write(data: string): number; flush(): unknown }).write(
      `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`,
    );
    (this.proc.stdin as { flush(): unknown }).flush();
  }

  private async request(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = ++this.seq;
    const answer = new Promise<Record<string, unknown>>((ok) => this.waiting.set(id, ok));
    this.send({ id, method, params });
    const message = await withTimeout(answer, `MCP ${method}`);
    if (message.error) throw new Error(`MCP ${method}: ${JSON.stringify(message.error)}`);
    return message.result as Record<string, unknown>;
  }

  async start(): Promise<string[]> {
    await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "claude-falso", version: "1.0.0" },
    });
    this.send({ method: "notifications/initialized" });
    const listed = await this.request("tools/list", {});
    return (listed.tools as Array<{ name: string }>).map((tool) => tool.name);
  }

  /** What a tool answered, as text; `error` when it failed. Kept for the final search. */
  async callTool(name: string, args: Record<string, unknown>) {
    const result = await this.request("tools/call", { name, arguments: args });
    const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");
    seen.push(text);
    return { text, error: result.isError === true };
  }

  async stop(): Promise<void> {
    this.proc.kill();
    await this.proc.exited;
  }
}

async function run(work: string): Promise<void> {
  mkdirSync(work, { recursive: true });
  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  const dataDir = join(work, "data");
  const config = {
    hostName: "smoke-actions",
    port: 0,
    token,
    dataDir,
    allowedRoots: [],
    runtime: "fake",
    hooks: { port: 0 },
    history: { roots: [join(work, "sem-historico")] },
  };
  writeFileSync(configPath, JSON.stringify(config));
  const secret = `dpl_${crypto.randomUUID().replaceAll("-", "")}_SEGREDO-DO-SMOKE`;
  const vault = new AppVault();
  vault.set("deploy-token", secret);

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
  let claude: FakeClaude | undefined;
  try {
    const url = await withTimeout(
      (async () => {
        for (;;) {
          const found = out.join("").match(/listening on (ws:\/\/\S+)/)?.[1];
          if (found) return found;
          await Bun.sleep(20);
        }
      })(),
      "daemon anunciar a porta",
    );
    log(`daemon em ${url}`);
    const app = new App(url, vault);
    await app.open(token);

    step = "declarar as ações";
    // `console.log(process.env.TOKEN)` prints the token the daemon put in the environment.
    await app.call("actions.save", {
      definition: {
        name: "echo-token",
        description: "Imprime o token do deploy (só para o smoke)",
        run: [process.execPath, "-e", "console.log(process.env.TOKEN)"],
        env: { TOKEN: "{{secret.deploy-token}}" },
      },
      secretIds: ["deploy-token"],
    });
    await app.call("actions.save", {
      definition: {
        name: "diz",
        description: "Diz uma palavra",
        run: [process.execPath, "-e", "console.log(process.argv[1])", "{{param.palavra}}"],
        params: { palavra: { pattern: "^[a-z]{1,8}$", default: "oi" } },
      },
    });

    step = "o Claude falso pelo MCP";
    // The MCP command finds the daemon by the port in its config; the daemon chose its own.
    const port = new URL(url).port;
    const mcpConfig = join(work, "mcp-config.json");
    writeFileSync(mcpConfig, JSON.stringify({ ...config, port: Number(port) }));
    claude = new FakeClaude(["mcp", "--config", mcpConfig]);
    const tools = await claude.start();
    for (const name of ["list_actions", "run_action", "run_with_secret"]) {
      if (!tools.includes(name)) throw new Error(`falta a ferramenta ${name}`);
    }

    step = "list_actions sem segredos";
    const listed = await claude.callTool("list_actions", {});
    if (!listed.text.includes("echo-token")) throw new Error(`list_actions: ${listed.text}`);
    if (listed.text.includes("deploy-token") || listed.text.includes("TOKEN")) {
      throw new Error("list_actions mostrou o segredo ou a variável dele");
    }
    log("o Claude vê as ações, sem segredo nenhum");

    step = "run_action mascarado";
    const echoed = await claude.callTool("run_action", { name: "echo-token" });
    if (echoed.error) throw new Error(`run_action falhou: ${echoed.text}`);
    if (!echoed.text.includes("•••(deploy-token)")) {
      throw new Error(`a saída não veio mascarada: ${echoed.text}`);
    }
    if (app.requests.length !== 1 || app.requests[0]?.requester !== "claude") {
      throw new Error("o app devia ter recebido um pedido do Claude");
    }
    log("a ação imprimiu o próprio token e o Claude recebeu •••(deploy-token)");

    step = "parâmetro inválido recusado";
    const before = app.requests.length;
    const refused = await claude.callTool("run_action", {
      name: "diz",
      params: { palavra: "NÃO; permitido" },
    });
    if (!refused.error || !refused.text.includes("bad_request")) {
      throw new Error(`a ação com parâmetro inválido não foi recusada: ${refused.text}`);
    }
    const said = await claude.callTool("run_action", { name: "diz", params: { palavra: "ola" } });
    if (said.error || !said.text.includes("ola")) throw new Error(`diz: ${said.text}`);
    if (app.requests.length !== before)
      throw new Error("o parâmetro inválido chegou a pedir segredo");
    log("o parâmetro fora do padrão foi recusado; o válido rodou");

    step = "run_with_secret sem aprovação não roda";
    const marker = join(work, "rodou.txt");
    const command = `${JSON.stringify(process.execPath)} -e "require('node:fs').writeFileSync(process.argv[1], 'x')" ${JSON.stringify(marker)}`;
    app.mode = "deny";
    const blocked = await claude.callTool("run_with_secret", {
      command,
      secrets: ["deploy-token"],
    });
    const free = app.requests.at(-1);
    if (!blocked.error)
      throw new Error(`o comando livre sem aprovação não falhou: ${blocked.text}`);
    if (free?.approval !== "always" || free.command !== command) {
      throw new Error(
        `o pedido do comando livre devia ser always e levar o comando: ${JSON.stringify(free)}`,
      );
    }
    if (existsSync(marker)) throw new Error("o comando rodou sem a aprovação");
    log("o comando livre pediu aprovação, foi recusado e não rodou");

    step = "run_with_secret aprovado roda, mascarado";
    app.mode = "approve";
    const approved = await claude.callTool("run_with_secret", {
      command: `${JSON.stringify(process.execPath)} -e "console.log(process.env.DEPLOY_TOKEN)"`,
      secrets: ["deploy-token"],
    });
    if (approved.error || !approved.text.includes("•••(deploy-token)")) {
      throw new Error(`run_with_secret aprovado: ${approved.text}`);
    }
    log("aprovado, o comando livre rodou e a saída veio mascarada");
    app.close();
  } finally {
    await claude?.stop();
    daemon.kill();
    await daemon.exited;
  }

  step = "procurar o valor nos logs, no banco e no que o Claude recebeu";
  const haystacks = [
    ...filesOf(dataDir),
    Buffer.from(out.join("")),
    Buffer.from(err.join("")),
    Buffer.from(seen.join("\n")),
  ];
  for (const needle of [
    secret,
    Buffer.from(secret).toString("base64"),
    Buffer.from(secret).toString("hex"),
  ]) {
    if (haystacks.some((hay) => hay.includes(needle))) {
      throw new Error("o valor do segredo apareceu nos logs, no banco ou no que o Claude recebeu");
    }
  }
  log(
    `${filesOf(dataDir).length} arquivos do daemon, os logs e o que o Claude recebeu sem o valor`,
  );
}

const work = realTempDir("flightdeck-smoke-actions-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoNetwork(network);
  console.log("SMOKE ACTIONS OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE ACTIONS FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
