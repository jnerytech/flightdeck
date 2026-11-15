/**
 * The files the demo seed writes before and between daemons: the repos, the project's config and
 * knowledge, the transcripts and the cost history. Nothing here starts a daemon or opens a socket.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { acoesActions } from "../e2e/journeys.ts";
import { DEMO_TELEPORT_SESSIONS } from "./teleport.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const FIXTURES = join(ROOT, "apps/daemon/test/fixtures/history");

const ECO_SERVER = join(ROOT, "apps/daemon/test/fixtures/mcp/eco-server.ts");

/** The project's MCP servers: a local one that can be tested and a remote one with a secret. */
export const MCP_JSON = JSON.stringify(
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

export const CLAUDE_MD =
  "# flightdeck-web\n\nUse TypeScript estrito. Rode os testes antes de commitar.\n";
export const AGENT_MD = `---
name: revisor
description: Revisa o diff antes do commit
tools: Read, Grep
model: sonnet
---
Você revisa código: aponte o risco antes do estilo.
`;
export const SKILL_MD = `---
name: deploy
description: Publica o app em produção depois dos testes
---
1. Rode os testes.
2. Gere o build.
3. Publique.
`;

/** What the user keeps in ~/.claude and ~/.claude.json: the Agente screen shows it read-only. */
export function writeUserConfig(home: string): void {
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

/** A workflow with a plan, a gate that asks to review it and the implementation. */
/** The library of the design-system project: one document of each status the knowledge journey moves (issue #76). */
export const KNOWLEDGE_DOCS: Record<string, string> = {
  "docs/adr/0001-design-tokens.md":
    "---\nstatus: valid\n---\n# Design tokens come from one file\n\nColors and spacing are read from tokens.json.\n",
  "docs/rfc/0002-dark-mode.md":
    "---\nstatus: transitional\n---\n# Dark mode for every screen\n\nShipping screen by screen.\n",
  "docs/adr/0003-fixed-grid.md":
    "---\nstatus: obsolete\n---\n# A fixed twelve column grid\n\nReplaced by the token spacing.\n",
};

/** One versioned action per language: the actions journey trusts it from the Ações screen. */
export const ACTIONS_YAML = acoesActions()
  .map(
    (name) => `- name: ${name}
  description: Mostra a versão do Bun
  run: ["bun", "--version"]
`,
  )
  .join("");

export const WORKFLOW = `steps:
  - id: plan
    agent: { prompt: "Escreva o plano da mudança" }
  - id: approve
    gate: { message: "Aprovar o plano?", show: "{{steps.plan.output}}" }
  - id: implement
    agent: { prompt: "Implemente: {{steps.approve.output}}" }
`;

export function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" }); // NOSONAR: git from the PATH of the developer running the script
}

export function repo(path: string, files: Record<string, string>): string {
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

export const userLine = (uuid: string, text: string, cwd: string, ts: string) =>
  JSON.stringify({
    type: "user",
    uuid,
    cwd,
    timestamp: ts,
    message: { role: "user", content: text },
  });
export const assistantLine = (uuid: string, text: string, cwd: string, ts: string) =>
  JSON.stringify({
    type: "assistant",
    uuid,
    cwd,
    timestamp: ts,
    message: { role: "assistant", content: [{ type: "text", text }] },
  });

/** The session of the trace fixture, written into the demo's history. */
export const TRACE_SESSION = "bbbbbbbb-0000-4000-8000-000000000025";

/**
 * The trace fixture (two turns, tools, a thought, three subagents, one inside another) as a
 * finished session of the demo: its folder, and today's date so the costs have numbers.
 */
function writeTraceSession(dir: string, cwd: string): void {
  const source = join(FIXTURES, "../trace");
  const today = new Date().toISOString().slice(0, 10);
  const adapt = (text: string) =>
    text
      .replaceAll("2026-11-01", today)
      // The usage counts a message id once, for the first file read (readdir order differs between
      // machines): the trace session keeps its own ids, apart from the usage transcript's.
      .replaceAll(/"id": ?"msg_/g, '"id": "msg_trace-')
      .replaceAll('"sessionId"', `"cwd":${JSON.stringify(cwd)},"sessionId"`);
  writeFileSync(
    join(dir, `${TRACE_SESSION}.jsonl`),
    adapt(readFileSync(join(source, "main.jsonl"), "utf8")),
  );
  const subagents = join(dir, TRACE_SESSION, "subagents");
  mkdirSync(subagents, { recursive: true });
  for (const name of readdirSync(join(source, "subagents"))) {
    writeFileSync(
      join(subagents, name),
      adapt(readFileSync(join(source, "subagents", name), "utf8")),
    );
  }
}

/**
 * Transcripts of finished terminal sessions: many short ones, a long one and two with usage. With
 * `movable`, the two newest have a UUID name (one per language): resumed, each is a session that can move to the other host
 * (issue #100), and the count stays the same.
 */
export function writeHistory(history: string, cwd: string, movable = false): void {
  const dir = join(history, "-demo");
  mkdirSync(dir, { recursive: true });
  const topics = ["testes", "build", "deploy", "migração", "lint", "docs", "cache", "fila", "logs"];
  for (let i = 0; i < 64; i++) {
    const ts = new Date(Date.now() - (i + 1) * 3_600_000).toISOString();
    const topic = topics[i % topics.length];
    writeFileSync(
      join(
        dir,
        movable && i < 2
          ? `${Object.values(DEMO_TELEPORT_SESSIONS)[i]}.jsonl`
          : `hist-${String(i).padStart(3, "0")}.jsonl`,
      ),
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
  writeTraceSession(dir, cwd);
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
        [
          userLine(`${id}-u`, `Tarefa ${n} em ${basename(project)}`, project, at(12)),
          ...turns,
        ].join("\n") + "\n",
      );
    }
  }
}
