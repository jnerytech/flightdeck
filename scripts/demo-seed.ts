/**
 * Data for `bun run demo` (phase 10): two `--runtime fake` daemons in this process, with temporary
 * homes, projects and transcripts, seeded through the protocol like an app would, plus an offline
 * host and one that speaks an old protocol. Nothing leaves the machine and no real data is read:
 * HOME points to a temporary folder before any daemon starts.
 *
 * What the prints need is all here: sessions running, waiting (Bash, Write, Edit and an MCP tool),
 * idle and ended; cards in every column and one with a diff; an empty project; 60+ sessions and a
 * long transcript; the plan quota; costs from usage in the transcripts; a very long title.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { type Ack, parseServerMessage } from "@flightdeck/protocol";
import { loadConfig } from "../apps/daemon/src/config.ts";
import { startDaemon } from "../apps/daemon/src/main.ts";
import { commitWorkflow, sha256 } from "../apps/daemon/test/workflow-helpers.ts";
import type { DemoHost } from "../apps/desktop/src/demo/boot.ts";
import { ACOES_ACTION } from "./lib/e2e-journeys.ts";
import { installFakeCli } from "./test/fake-cli.ts";
import { realTempDir } from "./test/temp-dir.ts";

const ROOT = resolve(import.meta.dir, "..");
const FIXTURES = join(ROOT, "apps/daemon/test/fixtures/history");
/** The terminal session that waits for a high-risk Bash (the e2e journey opens it by name). */
export const DANGER_SESSION = "Limpar a pasta build";
const LONG_TITLE =
  "Migrar a autenticação do painel administrativo para o provedor novo sem derrubar as sessões abertas nem perder os tokens de serviço";

const ECO_SERVER = join(ROOT, "apps/daemon/test/fixtures/mcp/eco-server.ts");

/** The project's MCP servers: a local one that can be tested and a remote one with a secret. */
const MCP_JSON = JSON.stringify(
  {
    mcpServers: {
      eco: { command: process.execPath, args: [ECO_SERVER] },
      github: {
        type: "http",
        url: "https://mcp.example.com/github",
        headers: { Authorization: "Bearer demo-token" },
      },
    },
  },
  null,
  2,
);

const CLAUDE_MD = "# flightdeck-web\n\nUse TypeScript estrito. Rode os testes antes de commitar.\n";
const AGENT_MD = `---
name: revisor
description: Revisa o diff antes do commit
tools: Read, Grep
model: sonnet
---
Você revisa código: aponte o risco antes do estilo.
`;
const SKILL_MD = `---
name: deploy
description: Publica o app em produção depois dos testes
---
1. Rode os testes.
2. Gere o build.
3. Publique.
`;

/** What the user keeps in ~/.claude and ~/.claude.json: the Agente screen shows it read-only. */
function writeUserConfig(home: string): void {
  mkdirSync(join(home, ".claude", "agents"), { recursive: true });
  writeFileSync(join(home, ".claude", "CLAUDE.md"), "# Preferências\n\nResponda em português.\n");
  writeFileSync(
    join(home, ".claude", "agents", "pessoal.md"),
    "---\nname: pessoal\ndescription: Meu estilo de resposta\n---\nSeja direto.\n",
  );
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({ mcpServers: { contexto: { command: "npx", args: ["-y", "contexto-mcp"] } } }),
  );
}

/** Ids the prints open screens with. */
export interface DemoIds {
  waitingSession: string;
  idleSession: string;
  project: string;
  emptyProject: string;
  diffCard: string;
  /** A card whose workflow run waits at an open gate. */
  gateCard: string;
  /** The project's name, as the Agente screen is opened with it. */
  projectName: string;
  /** A session with two turns that changed files: the timeline's rewind and fork. */
  rewindSession: string;
  /** The Claude session id of `idleSession`, whose Tempo tab has a timeline (phase 23). */
  telemetrySession: string;
}

/** A workflow with a plan, a gate that asks to review it and the implementation. */
/** One versioned action per language: the actions journey trusts it from the Ações screen. */
const ACTIONS_YAML = Object.values(ACOES_ACTION)
  .map(
    (name) => `- name: ${name}
  description: Mostra a versão do Bun
  run: ["bun", "--version"]
`,
  )
  .join("");

const WORKFLOW = `steps:
  - id: plan
    agent: { prompt: "Escreva o plano da mudança" }
  - id: approve
    gate: { message: "Aprovar o plano?", show: "{{steps.plan.output}}" }
  - id: implement
    agent: { prompt: "Implemente: {{steps.approve.output}}" }
`;

export interface DemoSeed {
  hosts: DemoHost[];
  ids: DemoIds;
  stop(): Promise<void>;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function repo(path: string, files: Record<string, string>): string {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", "main");
  git(path, "config", "user.email", "demo@flightdeck.local");
  git(path, "config", "user.name", "Demo");
  git(path, "config", "commit.gpgsign", "false");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(path, name)), { recursive: true });
    writeFileSync(join(path, name), text);
  }
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "inicial");
  return path;
}

/** A protocol client that answers pings and keeps `external.watch` open (requests stay held). */
class Client {
  private readonly ws: WebSocket;
  private readonly acks = new Map<string, (ack: Ack) => void>();
  /** The open permission request of each session, from the summaries (`sessions.watch`). */
  readonly requests = new Map<string, string | undefined>();
  private seq = 0;

  private constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (msg) => {
      const frame = parseServerMessage(String(msg.data));
      if (frame.type === "ack") this.acks.get(frame.id)?.(frame);
      else if (frame.type === "event" && frame.event.type === "session.summary") {
        this.requests.set(frame.sessionId, frame.event.pendingPermissions[0]?.requestId);
      } else if (frame.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: frame.id }));
    });
  }

  static async open(url: string, token: string): Promise<Client> {
    const client = new Client(url);
    await new Promise((ok) => client.ws.addEventListener("open", ok, { once: true }));
    await client.call("hello", { token, client: "flightdeck-demo-seed" });
    await client.call("sessions.watch", {});
    return client;
  }

  call<T = unknown>(type: string, payload: object): Promise<T> {
    const id = String(++this.seq);
    return new Promise((ok, fail) => {
      this.acks.set(id, (ack) =>
        ack.ok ? ok(ack.data as T) : fail(new Error(`${type}: ${ack.error.message}`)),
      );
      this.ws.send(JSON.stringify({ id, type, payload }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function until<T>(
  check: () => Promise<T | null | undefined | false>,
  what: string,
): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`demo: tempo esgotado em ${what}`);
    await Bun.sleep(50);
  }
}

const userLine = (uuid: string, text: string, cwd: string, ts: string) =>
  JSON.stringify({
    type: "user",
    uuid,
    cwd,
    timestamp: ts,
    message: { role: "user", content: text },
  });
const assistantLine = (uuid: string, text: string, cwd: string, ts: string) =>
  JSON.stringify({
    type: "assistant",
    uuid,
    cwd,
    timestamp: ts,
    message: { role: "assistant", content: [{ type: "text", text }] },
  });

/** Transcripts of finished terminal sessions: many short ones, a long one and two with usage. */
function writeHistory(history: string, cwd: string): void {
  const dir = join(history, "-demo");
  mkdirSync(dir, { recursive: true });
  const topics = ["testes", "build", "deploy", "migração", "lint", "docs", "cache", "fila", "logs"];
  for (let i = 0; i < 64; i++) {
    const ts = new Date(Date.now() - (i + 1) * 3_600_000).toISOString();
    const topic = topics[i % topics.length];
    writeFileSync(
      join(dir, `hist-${String(i).padStart(3, "0")}.jsonl`),
      `${[
        userLine(`h${i}u`, `Ajuste ${i + 1}: revise ${topic} do módulo ${i % 7}`, cwd, ts),
        assistantLine(`h${i}a`, `Feito: ${topic} revisado.`, cwd, ts),
      ].join("\n")}\n`,
    );
  }
  const long: string[] = [];
  for (let i = 0; i < 300; i++) {
    const ts = new Date(Date.now() - 30 * 86_400_000 + i * 60_000).toISOString();
    long.push(
      i % 2 === 0
        ? userLine(`l${i}`, `Passo ${i / 2 + 1}: continue a revisão do arquivo ${i}.ts`, cwd, ts)
        : assistantLine(`l${i}`, `Revisei o arquivo ${i - 1}.ts e ajustei os tipos.`, cwd, ts),
    );
  }
  writeFileSync(join(dir, "hist-longo.jsonl"), `${long.join("\n")}\n`);
  // Usage of today, so the costs and the budgets have numbers.
  const now = new Date().toISOString();
  const usage = readFileSync(join(FIXTURES, "usage-main.jsonl"), "utf8")
    .replaceAll("__CWD__", JSON.stringify(cwd).slice(1, -1))
    .replace(/"timestamp":"[^"]+"/g, `"timestamp":"${now}"`);
  writeFileSync(join(dir, "aaaaaaaa-0000-4000-8000-000000000001.jsonl"), usage);
  writeCostsHistory(dir, cwd);
}

/** An assistant turn with the usage the costs read: one request id per turn. */
const turnLine = (id: string, cwd: string, ts: string, model: string, scale: number) =>
  JSON.stringify({
    type: "assistant",
    uuid: `${id}-line`,
    cwd,
    timestamp: ts,
    message: {
      id: `msg_${id}`,
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: "Feito." }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 800 * scale,
        output_tokens: 300 * scale,
        cache_read_input_tokens: 9000 * scale,
        cache_creation_input_tokens: 1200 * scale,
        cache_creation: {
          ephemeral_5m_input_tokens: 1200 * scale,
          ephemeral_1h_input_tokens: 0,
        },
      },
    },
  });

/**
 * A week of usage across three projects and three models, so the Custos screen has totals, a
 * chart by day, breakdowns and top sessions to show.
 */
function writeCostsHistory(dir: string, cwd: string): void {
  const projects = ["flightdeck-web", "api-gateway", "docs-site"].map((name) =>
    join(dirname(cwd), name),
  );
  const models = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
  let n = 0;
  for (let day = 0; day < 7; day++) {
    for (let k = 0; k < 4; k++) {
      n++;
      const project = projects[(day + k) % projects.length] as string;
      const model = models[(day * 2 + k) % models.length] as string;
      const at = (minutes: number) =>
        new Date(Date.now() - day * 86_400_000 - (k * 50 + minutes) * 60_000).toISOString();
      const id = `usage-${String(n).padStart(3, "0")}`;
      const turns = Array.from({ length: 2 + ((day + k) % 3) }, (_, t) =>
        turnLine(`${id}-${t}`, project, at(10 - t), model, 1 + ((day * 3 + k + t) % 4)),
      );
      writeFileSync(
        join(dir, `${id}.jsonl`),
        `${[userLine(`${id}-u`, `Tarefa ${n} em ${basename(project)}`, project, at(12)), ...turns].join("\n")}\n`,
      );
    }
  }
}

interface HostRun {
  url: string;
  token: string;
  client: Client;
  config: string;
  projects: string;
  /** The daemon's data folder: where it publishes its OTLP receiver (phase 23). */
  dataDir: string;
  stop(): Promise<void>;
}

async function host(work: string, name: string): Promise<HostRun> {
  const base = join(work, name);
  const projects = join(base, "projects");
  const history = join(base, "claude-projects");
  mkdirSync(projects, { recursive: true });
  mkdirSync(history, { recursive: true });
  writeHistory(history, join(projects, "flightdeck-web"));
  const token = crypto.randomUUID().replaceAll("-", "");
  const config = join(base, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      hostName: name,
      port: 0,
      token,
      dataDir: join(base, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      // The hooks token and a free port for the OTLP receiver, which listens once hooks are set up.
      hooks: { port: 0, token: crypto.randomUUID().replaceAll("-", "") },
      telemetry: { port: 0 },
      history: { roots: [history] },
    }),
  );
  const quiet = { log: () => {}, error: (m: string) => console.error(`  [${name}] ${m}`) };
  const daemon = await startDaemon(
    { command: "start", config, runtime: "fake" },
    { ...process.env },
    quiet,
  );
  const client = await Client.open(daemon.url, token);
  return {
    url: daemon.url,
    token,
    client,
    config,
    projects,
    dataDir: join(base, "data"),
    stop: async () => {
      client.close();
      await daemon.stop();
    },
  };
}

/** The OTLP log records of one prompt, in the shape Claude Code's exporter sends. */
interface DemoEvent {
  name: string;
  afterMs: number;
  attrs: Record<string, string | number>;
}

/** Sends events to the host's OTLP receiver, as an exporter would: the same path as a real session. */
async function sendTelemetry(
  host: HostRun,
  sessionId: string,
  promptId: string,
  startedAt: number,
  events: DemoEvent[],
): Promise<void> {
  const published = JSON.parse(readFileSync(join(host.dataDir, "telemetry.json"), "utf8")) as {
    url: string;
  };
  const token = (JSON.parse(readFileSync(host.config, "utf8")) as { telemetry: { token: string } })
    .telemetry.token;
  const value = (v: string | number) =>
    typeof v === "number"
      ? Number.isInteger(v)
        ? { intValue: String(v) }
        : { doubleValue: v }
      : { stringValue: v };
  const body = {
    resourceLogs: [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            logRecords: events.map((e) => ({
              timeUnixNano: String(BigInt(startedAt + e.afterMs) * 1_000_000n),
              body: { stringValue: `claude_code.${e.name}` },
              attributes: Object.entries({
                "event.name": `claude_code.${e.name}`,
                "session.id": sessionId,
                "prompt.id": promptId,
                ...e.attrs,
              }).map(([key, v]) => ({ key, value: value(v) })),
            })),
          },
        ],
      },
    ],
  };
  const res = await fetch(`${published.url}/v1/logs`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`telemetria do demo: ${res.status}`);
}

/** Two prompts: API requests, a permission you answered after 9 s, a slow Bash, an API error. */
const PROMPT_ONE: DemoEvent[] = [
  { name: "user_prompt", afterMs: 0, attrs: { prompt_length: 42 } },
  {
    name: "api_request",
    afterMs: 1_200,
    attrs: { request_id: "r1", duration_ms: 1_100, cost_usd: 0.012, model: "claude-opus-5-5" },
  },
  {
    name: "tool_decision",
    afterMs: 1_300,
    attrs: { tool_use_id: "t1", tool_name: "Read", decision: "accept", source: "config" },
  },
  {
    name: "tool_result",
    afterMs: 1_450,
    attrs: { tool_use_id: "t1", tool_name: "Read", duration_ms: 120, success: "true" },
  },
  {
    name: "api_request",
    afterMs: 3_000,
    attrs: { request_id: "r2", duration_ms: 1_400, cost_usd: 0.018, model: "claude-opus-5-5" },
  },
  {
    name: "tool_decision",
    afterMs: 12_000,
    attrs: { tool_use_id: "t2", tool_name: "Bash", decision: "accept", source: "user_temporary" },
  },
  {
    name: "tool_result",
    afterMs: 16_200,
    attrs: { tool_use_id: "t2", tool_name: "Bash", duration_ms: 4_200, success: "true" },
  },
  {
    name: "api_error",
    afterMs: 17_000,
    attrs: { request_id: "r3", status_code: 529, duration_ms: 90 },
  },
];
const PROMPT_TWO: DemoEvent[] = [
  { name: "user_prompt", afterMs: 0, attrs: { prompt_length: 18 } },
  {
    name: "api_request",
    afterMs: 900,
    attrs: { request_id: "r4", duration_ms: 800, cost_usd: 0.009, model: "claude-opus-5-5" },
  },
  {
    name: "tool_decision",
    afterMs: 1_000,
    attrs: { tool_use_id: "t3", tool_name: "Edit", decision: "accept", source: "config" },
  },
  {
    name: "tool_result",
    afterMs: 1_300,
    attrs: { tool_use_id: "t3", tool_name: "Edit", duration_ms: 300, success: "true" },
  },
];

/** Hosts the demo pairs with: the seeded ones, an offline one and one of an old protocol. */
export async function seedDemo(log: (msg: string) => void = () => {}): Promise<DemoSeed> {
  const work = realTempDir("fd-demo-");
  // Before any daemon: hooks, settings and the history never touch the real home.
  const home = join(work, "home");
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  writeUserConfig(home);
  // The terminal of a host opens `$SHELL`: a fixed prompt, so no machine (the CI runner's user and
  // host name, the folder) leaks into the prints. POSIX only: Windows keeps its own default shell.
  if (process.platform !== "win32") {
    const shell = join(work, "demo-shell.sh");
    writeFileSync(
      shell,
      "#!/bin/sh\nexport PS1='demo$ ' USER=demo LOGNAME=demo HOSTNAME=demo\nexec bash --noprofile --norc -i\n",
    );
    chmodSync(shell, 0o755);
    process.env.SHELL = shell;
  }
  // A `gh` that lists one issue (the issues of phase 13 come through the CLI), before any daemon.
  const issue = {
    number: 7,
    title: "Corrigir o login com SSO",
    body: "O login falha quando o SSO devolve um e-mail em maiúsculas.",
    url: "https://github.com/Acme/App/issues/7",
    author: { login: "ana" },
    labels: [{ name: "bug" }],
    createdAt: "2026-10-01T10:00:00Z",
    authorAssociation: "MEMBER",
  };
  const gh = installFakeCli("gh", [
    { args: ["api", "user"], stdout: "eu\n" },
    { args: ["issue", "list"], stdout: JSON.stringify([issue]) },
    { args: ["issue", "view", "7"], stdout: JSON.stringify(issue) },
  ]);

  // A `claude` for the Plugins page (phase 26), before any daemon: one installed plugin whose hook
  // listens on PreToolUse, and one the marketplace offers. The real CLI is never run.
  const plugin = join(work, "plugins", "deploy-tools");
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, "hooks"), { recursive: true });
  mkdirSync(join(plugin, "skills", "deploy"), { recursive: true });
  writeFileSync(
    join(plugin, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "deploy-tools", version: "1.2.0", description: "Publica o app" }),
  );
  writeFileSync(
    join(plugin, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
      },
    }),
  );
  writeFileSync(join(plugin, "skills", "deploy", "SKILL.md"), SKILL_MD);
  const claude = installFakeCli("claude", [
    {
      args: ["marketplace", "list"],
      stdout: JSON.stringify([
        { name: "acme", source: "github", repo: "acme/plugins", installLocation: plugin },
      ]),
    },
    {
      args: ["list", "--json"],
      stdout: JSON.stringify({
        installed: [
          {
            id: "deploy-tools@acme",
            version: "1.2.0",
            scope: "user",
            enabled: true,
            installPath: plugin,
          },
        ],
        available: [
          {
            pluginId: "lint-rules@acme",
            name: "lint-rules",
            marketplaceName: "acme",
            description: "Regras de lint para o time",
            version: "0.4.0",
          },
        ],
      }),
    },
  ]);

  const alfa = await host(work, "alfa");
  const beta = await host(work, "beta");
  log(`alfa em ${alfa.url}, beta em ${beta.url}`);
  const { client } = alfa;

  // Projects: one with cards in every column (and one with a diff), one empty.
  const web = repo(join(alfa.projects, "flightdeck-web"), {
    "README.md": "# flightdeck-web\n",
    "app.ts": "export const versao = 1;\n",
    ".mcp.json": MCP_JSON,
    "CLAUDE.md": CLAUDE_MD,
    ".claude/agents/revisor.md": AGENT_MD,
    ".claude/skills/deploy/SKILL.md": SKILL_MD,
    ".flightdeck/actions.yaml": ACTIONS_YAML,
  });
  git(web, "remote", "add", "origin", "git@github.com:Acme/App.git");
  repo(join(alfa.projects, "vazio"), { "README.md": "# vazio\n" });
  commitWorkflow(web, "feature", WORKFLOW);
  const project = await client.call<{ id: string }>("project.add", { path: web });
  await client.call("workflow.trust", {
    projectId: project.id,
    name: "feature",
    hash: sha256(WORKFLOW),
  });
  await client.call("project.update", { projectId: project.id, issues: { provider: "github" } });
  const empty = await client.call<{ id: string }>("project.add", {
    path: join(alfa.projects, "vazio"),
  });
  const card = (title: string, description: string) =>
    client.call<{ id: string }>("card.create", { projectId: project.id, title, description });
  await card("Documentar a API pública", "Escreva o guia de uso.");
  await card(LONG_TITLE, "Planeje a migração.");
  const diff = await card("Somar no total do carrinho", "Corrija a soma. [commit]");
  await client.call("card.start", { cardId: diff.id });
  // The run stops at its gate: an open request in "Precisa de você", with its steps on the card.
  const gated = await card("Revisar o fluxo de login", "Faça o plano e peça aprovação.");
  await client.call("card.start", { cardId: gated.id, workflow: "feature" });
  const review = await card("Revisar mensagens de erro", "Padronize os textos.");
  await client.call("card.move", { cardId: review.id, column: "review" });
  const waiting = await card("Aguardando o time de design", "Espere o layout.");
  await client.call("card.move", { cardId: waiting.id, column: "waiting" });
  const done = await card("Atualizar dependências", "Atualize e rode os testes.");
  await client.call("card.move", { cardId: done.id, column: "done" });

  // Two budgets far above the day's usage, so Configurações lists them without raising an alert.
  await client.call("budget.set", {
    scope: "host",
    period: "day",
    limitUsd: 500,
    action: "notify",
  });
  await client.call("budget.set", {
    scope: "project",
    projectKey: "github.com/acme/app",
    period: "month",
    limitUsd: 5000,
    action: "queue",
  });

  // The project's auto memory (phase 26): an index, two topic files and one the index leaves out.
  const remember = (name: string, content: string) =>
    client.call("memory.write", {
      projectId: project.id,
      name,
      content,
      expectedHash: null,
      confirm: true,
    });
  await remember(
    "MEMORY.md",
    "- [Perfil](user_role.md) — quem usa o projeto\n- [Testes](feedback_testes.md) — rodar a suíte inteira antes do commit\n",
  );
  await remember(
    "user_role.md",
    "---\nname: perfil\ndescription: quem usa o projeto\ntype: user\n---\n\nA equipe de plataforma mantém o app.\n",
  );
  await remember(
    "feedback_testes.md",
    "---\nname: testes\ndescription: rodar a suíte inteira\ntype: feedback\n---\n\nRode a suíte inteira antes do commit.\n",
  );
  await remember("solta.md", "Uma nota que o índice não cita.\n");

  // A change in the working tree, for the Mudanças tab of the sessions working in this folder.
  writeFileSync(join(web, "app.ts"), "export const versao = 2;\n");

  // Managed sessions: waiting for Bash, waiting for Write, idle, ended; the plan quota.
  const later = (hours: number) => Math.floor(Date.now() / 1000) + hours * 3600;
  const session = (name: string, prompt: string) =>
    client.call<{ sessionId: string }>("session.create", { cwd: web, name, prompt });
  const bash = await session("Testes do backend", "[bash] rode a suíte");
  await session("Changelog da versão", "[tool] escreva o changelog");
  const idle = await session(
    "Revisão do PR 128",
    `Revise o PR. [ratelimit:five_hour=0.62@${later(2)}] [ratelimit:seven_day=0.35@${later(100)}]`,
  );
  await session(LONG_TITLE, "Planeje os passos.");
  const ended = await session("Sessão antiga", "Liste os arquivos.");
  const statusOf = async (sessionId: string) => {
    const list = await client.call<{ sessions: Array<{ id: string; status: string }> }>(
      "session.list",
      {},
    );
    return list.sessions.find((s) => s.id === sessionId)?.status;
  };
  await until(async () => (await statusOf(bash.sessionId)) === "awaiting_permission", "Bash");
  await until(async () => (await statusOf(ended.sessionId)) === "idle", "sessão antiga");
  await client.call("session.close", { sessionId: ended.sessionId });

  // Two turns that change files: each waits for a permission (the snapshot before it is taken by
  // then), the seed edits the files as the agent would, and approving ends the turn.
  const rewind = await session("Carrinho: soma do total", "[tool] Corrija a soma do carrinho.");
  const claudeOf = async (sessionId: string) => {
    const list = await client.call<{
      sessions: Array<{ id: string; claudeSessionId: string | null }>;
    }>("session.list", {});
    return list.sessions.find((s) => s.id === sessionId)?.claudeSessionId;
  };
  // Timing for the Tempo tab (the idle session) and for Custos (the session with usage).
  const telemetrySession = (await until(() => claudeOf(idle.sessionId), "id da revisão")) as string;
  const when = Date.now() - 10 * 60_000;
  for (const id of [telemetrySession, "aaaaaaaa-0000-4000-8000-000000000001"]) {
    await sendTelemetry(alfa, id, "demo-prompt-1", when, PROMPT_ONE);
    await sendTelemetry(alfa, id, "demo-prompt-2", when + 60_000, PROMPT_TWO);
  }
  const rewindClaude = (await until(() => claudeOf(rewind.sessionId), "id do carrinho")) as string;
  const snapshotsOf = async () =>
    (
      await client.call<{ snapshots: Array<{ kind: string }> }>("snapshots.list", {
        claudeSessionId: rewindClaude,
      })
    ).snapshots;
  const editingTurn = async (edit: () => void, snapshotsAfter: number) => {
    await until(
      async () => (await snapshotsOf()).length >= snapshotsAfter - 1,
      "snapshot do turno",
    );
    await until(async () => client.requests.get(rewind.sessionId), "pedido do carrinho");
    edit();
    await client.call("permission.respond", {
      requestId: client.requests.get(rewind.sessionId),
      decision: "allow",
    });
    await until(async () => (await snapshotsOf()).length >= snapshotsAfter, "fim do turno");
  };
  await editingTurn(() => writeFileSync(join(web, "app.ts"), "export const versao = 2;\n"), 2);
  await client.call("session.send", {
    sessionId: rewind.sessionId,
    text: "[tool] Revise o arredondamento.",
  });
  await editingTurn(
    () =>
      writeFileSync(
        join(web, "carrinho.ts"),
        "export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n",
      ),
    4,
  );

  // Terminal sessions (hooks): one running, one waiting for Edit, one for an MCP tool. The
  // seed watches the external sessions, so the receptor holds their requests open.
  await client.call("hooks.install", { confirm: true });
  await client.call("external.watch", {});
  const status = await client.call<{ receptorUrl: string | null }>("hooks.status", {});
  const hooksToken = loadConfig(alfa.config).hooks.token ?? "";
  // A held PermissionRequest waits for the app for as long as the demo runs. Bun's `fetch` gives
  // up on a request after 6 minutes (and has no option to turn that off), which dropped the
  // seeded requests from the queue in a slow e2e run; `node:http` has no such limit.
  const hook = (sessionId: string, event: string, body: object) =>
    new Promise<void>((done) => {
      const req = request(
        `${status.receptorUrl}/hooks/${event}`,
        { method: "POST", headers: { Authorization: `Bearer ${hooksToken}` } },
        (res) => {
          res.resume();
          res.on("end", () => done());
          res.on("error", () => done());
        },
      );
      req.on("error", () => done());
      req.end(JSON.stringify({ session_id: sessionId, hook_event_name: event, cwd: web, ...body }));
    });
  for (const [id, prompt] of [
    ["ext-rodando", "suba o servidor de desenvolvimento"],
    ["ext-edit", "corrija o import quebrado"],
    ["ext-mcp", "abra uma issue para o bug do login"],
    ["ext-rm", "limpe os artefatos de build"],
  ] as const) {
    await hook(id, "SessionStart", { source: "startup" });
    await hook(id, "UserPromptSubmit", { prompt });
  }
  // Names, so the list tells the terminal sessions apart.
  await client.call("session.meta.set", {
    claudeSessionId: "ext-rodando",
    name: "Servidor de desenvolvimento",
  });
  await client.call("session.meta.set", {
    claudeSessionId: "ext-edit",
    name: "Corrigir o import quebrado",
  });
  await client.call("session.meta.set", {
    claudeSessionId: "ext-mcp",
    name: "Issue do bug de login",
  });
  await client.call("session.meta.set", { claudeSessionId: "ext-rm", name: DANGER_SESSION });
  void hook("ext-rm", "PermissionRequest", {
    tool_name: "Bash",
    tool_input: { command: "rm -rf build" },
  });
  void hook("ext-edit", "PermissionRequest", {
    tool_name: "Edit",
    tool_input: { file_path: join(web, "app.ts"), old_string: "1", new_string: "2" },
  });
  void hook("ext-mcp", "PermissionRequest", {
    tool_name: "mcp__github__create_issue",
    tool_input: { repo: "acme/flightdeck-web", title: "Login falha com SSO", labels: ["bug"] },
  });

  // beta: a quieter host.
  await beta.client.call("session.create", {
    cwd: beta.projects,
    name: "Rotina de backup",
    prompt: "Confira o backup.",
  });

  // An old daemon: answers hello refusing this app's protocol.
  const old = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("ws", { status: 426 })),
    websocket: {
      message(ws, raw) {
        const frame = JSON.parse(String(raw)) as { id: string };
        ws.send(
          JSON.stringify({
            type: "ack",
            id: frame.id,
            ok: false,
            error: { code: "protocol_incompatible", message: "protocolo 1 apenas" },
          }),
        );
      },
    },
  });
  // Reconnecting: a server that takes the connection and never answers the handshake.
  const slow = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Promise<Response>(() => {}),
  });
  // Offline: an address nothing listens on.
  const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const offlineUrl = `ws://127.0.0.1:${closed.port}/v1/ws`;
  closed.stop(true);

  log("dados semeados");
  return {
    hosts: [
      { id: "demo-alfa", name: "alfa", url: alfa.url, token: alfa.token },
      { id: "demo-beta", name: "beta", url: beta.url, token: beta.token },
      { id: "demo-offline", name: "notebook", url: offlineUrl, token: "x".repeat(32) },
      {
        id: "demo-slow",
        name: "estação",
        url: `ws://127.0.0.1:${slow.port}/v1/ws`,
        token: "x".repeat(32),
      },
      {
        id: "demo-old",
        name: "servidor antigo",
        url: `ws://127.0.0.1:${old.port}/v1/ws`,
        token: "x".repeat(32),
      },
    ],
    ids: {
      waitingSession: bash.sessionId,
      idleSession: idle.sessionId,
      project: project.id,
      emptyProject: empty.id,
      diffCard: diff.id,
      gateCard: gated.id,
      projectName: "flightdeck-web",
      rewindSession: rewind.sessionId,
      telemetrySession,
    },
    stop: async () => {
      gh.restore();
      claude.restore();
      old.stop(true);
      slow.stop(true);
      await alfa.stop();
      await beta.stop();
    },
  };
}
