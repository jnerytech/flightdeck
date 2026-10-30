#!/usr/bin/env bun
/**
 * Usage-rules smoke: a stand-in for Claude calls actions through the MCP of a `--runtime fake`
 * daemon whose secrets have rules. `deploy-staging` has an `allow` rule and runs without anyone
 * being asked; `logs-prod` is in `ask` inside a time window: outside it the use is denied, inside it
 * the delivery is refused until the app approves (holding the button, because it is prod) and then
 * it runs; an automation is denied by the default. The audit shows each decision and the value of
 * no secret is in any file, log or reply.
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
  /** Deliveries the daemon refused because the request had not been approved yet. */
  gateRefusals = 0;

  constructor(
    private readonly url: string,
    private readonly vault: AppVault,
  ) {}

  async open(token: string, watch = true): Promise<void> {
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
    await this.call("hello", { token, client: "smoke-rules-vault" });
    if (watch) await this.call("vault.watch", {});
  }

  /** The ack as it came, success or failure. */
  async ack(type: string, payload: unknown): Promise<Ack> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    return withTimeout(ack, `ack de ${type}`);
  }

  /** The user's answer to a request the daemon made. */
  private async answer(request: Request): Promise<void> {
    this.requests.push(request);
    if (this.mode === "deny") {
      await this.call("vault.deny", { requestId: request.requestId });
      return;
    }
    const deliver = () =>
      this.ack("vault.deliver", {
        secretId: request.secretId,
        value: this.vault.get(request.secretId),
        purpose: request.purpose,
        expiresAt: Date.now() + 30_000,
        requester: request.requester,
      });
    if (request.decision === "ask") {
      // The daemon does not accept the secret of a request that asks before it is approved.
      const early = await deliver();
      if (!early.ok) this.gateRefusals++;
      await this.call("vault.approve", {
        requestId: request.requestId,
        via: "app",
        heldMs: request.needsHold ? 2000 : 0,
      });
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
    hostName: "smoke-rules-vault",
    port: 0,
    token,
    dataDir,
    allowedRoots: [],
    runtime: "fake",
    hooks: { port: 0 },
    history: { roots: [join(work, "sem-historico")] },
  };
  writeFileSync(configPath, JSON.stringify(config));
  const staging = `stg_${crypto.randomUUID().replaceAll("-", "")}_SEGREDO-DO-SMOKE`;
  const prod = `prd_${crypto.randomUUID().replaceAll("-", "")}_SEGREDO-DO-SMOKE`;
  const vault = new AppVault();
  vault.set("staging-token", staging);
  vault.set("prod-token", prod);

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
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
    const automation = new App(url, vault);
    await automation.open(token, false);

    step = "declarar as ações e as regras";
    const echo = (name: string, secret: string, tags: string[]) => ({
      name,
      description: `Imprime o token de ${name} (só para o smoke)`,
      run: [process.execPath, "-e", "console.log(process.env.TOKEN)"],
      env: { TOKEN: `{{secret.${secret}}}` },
      tags,
    });
    await app.call("actions.save", {
      definition: echo("deploy-staging", "staging-token", ["staging"]),
    });
    await app.call("actions.save", { definition: echo("logs-prod", "prod-token", ["prod"]) });
    await app.call("vault.rules.set", {
      secretId: "staging-token",
      tags: ["staging"],
      rules: [
        {
          id: "liberar-staging",
          match: { requester: "claude", action: "deploy-staging" },
          decision: "allow",
        },
      ],
    });
    // The ceiling: the app is refused a rule that frees prod with no window.
    const ceiling = await app.ack("vault.rules.set", {
      secretId: "prod-token",
      rules: [{ id: "livre", match: { tags: ["prod"] }, decision: "allow" }],
    });
    if (ceiling.ok || !JSON.stringify(ceiling).includes("window")) {
      throw new Error("allow para prod sem janela devia ser recusado");
    }
    const allDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const today = allDays[new Date().getDay()] as string;
    const prodRule = (days: string[]) => [
      {
        id: "prod-janela",
        match: { requester: "claude", tags: ["prod"] },
        decision: "ask",
        window: { days, from: "00:00", to: "24:00" },
      },
    ];
    await app.call("vault.rules.set", {
      secretId: "prod-token",
      tags: ["prod"],
      rules: prodRule(allDays.filter((d) => d !== today)),
    });

    step = "o Claude falso pelo MCP";
    const mcpConfig = join(work, "mcp-config.json");
    writeFileSync(mcpConfig, JSON.stringify({ ...config, port: Number(new URL(url).port) }));
    claude = new FakeClaude(["mcp", "--config", mcpConfig]);
    const tools = await claude.start();
    if (!tools.includes("run_action")) throw new Error("falta a ferramenta run_action");

    step = "deploy-staging com a regra allow roda sem perguntar";
    const staged = await claude.callTool("run_action", { name: "deploy-staging" });
    if (staged.error || !staged.text.includes("•••(staging-token)")) {
      throw new Error(`deploy-staging: ${staged.text}`);
    }
    const first = app.requests[0];
    if (first?.decision !== "allow" || first.ruleId !== "liberar-staging") {
      throw new Error(`o pedido devia ser allow pela regra: ${JSON.stringify(first)}`);
    }
    if (app.gateRefusals !== 0) throw new Error("um pedido allow não devia precisar de aprovação");
    log("deploy-staging rodou pela regra allow, sem aprovação");

    step = "logs-prod fora da janela é negado";
    const before = app.requests.length;
    const outside = await claude.callTool("run_action", { name: "logs-prod" });
    if (!outside.error || !outside.text.includes("janela")) {
      throw new Error(`fora da janela devia ser negado: ${outside.text}`);
    }
    if (app.requests.length !== before) throw new Error("o pedido negado chegou ao app");
    log("logs-prod fora da janela foi negado, sem incomodar o app");

    step = "logs-prod dentro da janela pede aprovação";
    await app.call("vault.rules.set", {
      secretId: "prod-token",
      tags: ["prod"],
      rules: prodRule(allDays),
    });
    const inside = await claude.callTool("run_action", { name: "logs-prod" });
    if (inside.error || !inside.text.includes("•••(prod-token)")) {
      throw new Error(`logs-prod dentro da janela: ${inside.text}`);
    }
    const asked = app.requests.at(-1);
    if (asked?.decision !== "ask" || asked.needsHold !== true || asked.ruleId !== "prod-janela") {
      throw new Error(
        `o pedido de prod devia perguntar, segurando o botão: ${JSON.stringify(asked)}`,
      );
    }
    if ((app.gateRefusals as number) !== 1)
      throw new Error("a entrega antes da aprovação devia ter sido recusada");
    log("logs-prod dentro da janela: o daemon recusou a entrega até a aprovação, e depois rodou");

    step = "a automação é negada pelo padrão";
    const denied = await automation.ack("actions.run", {
      name: "deploy-staging",
      requestedBy: "automation",
    });
    if (denied.ok || !JSON.stringify(denied).includes("automation")) {
      throw new Error(`a automação devia ser negada: ${JSON.stringify(denied)}`);
    }
    log("a automação foi negada pelo padrão");

    step = "a auditoria";
    const { decisions } = await app.call<{
      decisions: Array<{
        outcome: string;
        requester: string;
        secretId: string;
        ruleId: string | null;
      }>;
    }>("vault.decisions", {});
    const outcomes = decisions.map((d) => `${d.requester}:${d.secretId}:${d.outcome}`).sort();
    const expected = [
      "automation:staging-token:refused",
      "claude:prod-token:approved",
      "claude:prod-token:refused",
      "claude:staging-token:allowed",
    ];
    if (JSON.stringify(outcomes) !== JSON.stringify(expected)) {
      throw new Error(`auditoria inesperada: ${JSON.stringify(outcomes)}`);
    }
    const report = await app.call<{ csv?: string }>("vault.report", { format: "csv" });
    if (!report.csv?.startsWith("secret,requester,outcome,count")) throw new Error("sem CSV");
    log("a auditoria tem as quatro decisões e o relatório sai em CSV");
    app.close();
    automation.close();
  } finally {
    await claude?.stop();
    daemon.kill();
    await daemon.exited;
  }

  step = "procurar os valores nos logs, no banco e no que o Claude recebeu";
  const haystacks = [
    ...filesOf(dataDir),
    Buffer.from(out.join("")),
    Buffer.from(err.join("")),
    Buffer.from(seen.join("\n")),
  ];
  for (const secret of [staging, prod]) {
    for (const needle of [
      secret,
      Buffer.from(secret).toString("base64"),
      Buffer.from(secret).toString("hex"),
    ]) {
      if (haystacks.some((hay) => hay.includes(needle))) {
        throw new Error(
          "o valor de um segredo apareceu nos logs, no banco ou no que o Claude recebeu",
        );
      }
    }
  }
  log(
    `${filesOf(dataDir).length} arquivos do daemon, os logs e o que o Claude recebeu sem os valores`,
  );
}

const work = realTempDir("flightdeck-smoke-rules-vault-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoNetwork(network);
  console.log("SMOKE RULES-VAULT OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE RULES-VAULT FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
