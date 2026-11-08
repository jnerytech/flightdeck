#!/usr/bin/env bun
/**
 * Personas smoke: a `--runtime fake` daemon and a fake `claude` first on the PATH. The nine
 * personas of the pack are listed, edited and put back; a managed session opened with a persona
 * is told, by the fake runtime, which role it plays (the body appended to the system prompt, the
 * effort, the tools and the persona-<id> subagents); a persona applied to an open session and
 * left again shows on the timeline; a versioned persona waits for trust by its hash; and
 * `flightdeckd claude --persona qa` hands the fake claude a temporary file for
 * --append-system-prompt-file, --model and --agents, which are gone when it ends, and does not
 * open claude at all for a persona that does not exist.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { type Ack, type EventEnvelope, parseServerMessage } from "@flightdeck/protocol";
import { installFakeClaude } from "../apps/daemon/test/fake-claude.ts";
import { readListenUrl } from "./lib/smoke-daemon.ts";
import { type Pending, pollUntil } from "./lib/smoke-poll";
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

const TIMEOUT_MS = 30_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");
const PACK = [
  "arquiteto",
  "seguranca",
  "qa",
  "sre",
  "performance",
  "revisor",
  "docs",
  "frontend",
  "dba",
  "coordenador",
  "dev",
];

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

function until<T>(check: () => T | Pending, what: string): Promise<T> {
  return pollUntil(check, what, { timeoutMs: TIMEOUT_MS, pauseMs: 50 });
}

class Client {
  private ws!: WebSocket;
  private readonly acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  events: EventEnvelope[] = [];

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
      else if (parsed.type === "event") this.events.push(parsed);
    });
    await new Promise<void>((ok, fail) => {
      this.ws.addEventListener("open", () => ok(), { once: true });
      this.ws.addEventListener("error", () => fail(new Error("falha ao conectar")), {
        once: true,
      });
    });
    await this.call("hello", { token, client: "smoke-personas" });
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

  /** The error of a call that should fail: `code: message`. */
  async fail(type: string, payload: unknown): Promise<string> {
    return this.call(type, payload).then(
      () => "conseguiu",
      (error: Error) => error.message,
    );
  }

  /** The events of one session, in order. */
  of(sessionId: string) {
    return this.events.filter((e) => e.sessionId === sessionId).map((e) => e.event);
  }

  close(): void {
    this.ws.close();
  }
}

/** The wrapper finds the daemon by the port in the config, so it cannot be 0. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  await new Promise((ok) => server.close(ok));
  return port;
}

interface Listed {
  personas: Array<{
    id: string;
    name: string;
    scope: string;
    modified: boolean;
    hash: string | null;
    trusted: boolean;
  }>;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type FakeClaudeHandle = ReturnType<typeof installFakeClaude>;
type Wrapper = (...args: string[]) => Promise<{ code: number; stderr: string }>;
interface FakeStart {
  args: string[];
  appended: string | null;
  appendedPath: string | null;
  agents: Record<string, { description: string }> | null;
  agentsPath: string | null;
}

async function checkPack(client: Client): Promise<void> {
  step = "o pacote";
  const pack = await client.call<Listed>("personas.list", { scope: "host" });
  check(
    pack.personas.map((p) => p.id).join(",") === PACK.join(",") &&
      pack.personas.every((p) => p.scope === "pack"),
    `o pacote devia ter as onze, na ordem: ${pack.personas.map((p) => p.id).join(",")}`,
  );
  const english = await client.call<Listed>("personas.list", { scope: "host", language: "en" });
  check(
    english.personas.some((p) => p.name === "Security reviewer"),
    "faltou o pacote em inglês",
  );
  log("as nove personas do pacote, em pt-BR e em inglês");
}

async function checkEditAndReset(client: Client): Promise<void> {
  step = "editar e restaurar";
  const secret = `ghp_${"0123456789abcdef".repeat(2)}0123`;
  const refused = await client.fail("personas.save", {
    scope: "host",
    persona: { id: "ruim", name: "Ruim", description: "d", body: `Use ${secret}` },
  });
  check(
    refused.includes("persona_secret") && !refused.includes(secret),
    `devia recusar o segredo sem repeti-lo: ${refused}`,
  );
  await client.call("personas.save", {
    scope: "host",
    persona: { id: "qa", name: "Meu QA", description: "Editada", body: "Seja breve." },
  });
  const edited = await client.call<Listed>("personas.list", { scope: "host" });
  check(
    edited.personas.find((p) => p.id === "qa")?.modified,
    "a edição devia aparecer como modificada",
  );
  await client.call("personas.reset", { id: "qa" });
  const back = await client.call<Listed>("personas.list", { scope: "host" });
  check(back.personas.find((p) => p.id === "qa")?.scope === "pack", "reset devia voltar ao pacote");
  log("um segredo foi recusado sem ser repetido; a edição do pacote foi feita e desfeita");
}

async function checkManagedSession(client: Client, project: string): Promise<void> {
  step = "sessão gerenciada com persona";
  const { sessionId } = await client.call<{ sessionId: string }>("session.create", {
    cwd: project,
    prompt: "[persona] quem é você?",
    persona: { id: "seguranca" },
  });
  await client.call("session.subscribe", { sessionId, sinceSeq: 0 });
  await until(
    () => client.of(sessionId).some((e) => e.type === "turn.result"),
    "a resposta da sessão",
  );
  const reply = client
    .of(sessionId)
    .flatMap((e) => (e.type === "message.assistant" ? e.blocks : []))
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n");
  for (const part of [
    "Persona: Você atua como revisor de segurança sênior.",
    "esforço=high",
    "ferramentas=Read,Grep,Glob,Bash",
    "persona-qa",
  ]) {
    check(reply.includes(part), `a sessão devia ter aberto no papel (${part}): ${reply}`);
  }
  const listed = await client.call<{
    sessions: Array<{ id: string; permissionMode: string; persona?: { id: string } }>;
  }>("session.list", {});
  const mine = listed.sessions.find((s) => s.id === sessionId);
  check(
    mine?.persona?.id === "seguranca" && mine.permissionMode === "plan",
    `selo e modo plan esperados: ${JSON.stringify(mine)}`,
  );
  log(
    "a sessão abriu como revisor de segurança: corpo, esforço, ferramentas, subagentes, modo plan e selo",
  );
}

async function checkApplyAndClear(client: Client, project: string): Promise<void> {
  step = "aplicar e voltar ao normal";
  const open = await client.call<{ sessionId: string }>("session.create", {
    cwd: project,
    prompt: "olá",
  });
  await client.call("session.subscribe", { sessionId: open.sessionId, sinceSeq: 0 });
  await until(
    () => client.of(open.sessionId).some((e) => e.type === "turn.result"),
    "o primeiro turno",
  );
  await client.call("session.applyPersona", { sessionId: open.sessionId, persona: { id: "qa" } });
  await until(
    () =>
      client
        .of(open.sessionId)
        .some((e) => e.type === "message.user" && e.text.includes("A partir de agora, atue como")),
    "a mensagem de troca de papel",
  );
  check(
    client.of(open.sessionId).some((e) => e.type === "persona.applied"),
    "faltou persona.applied",
  );
  await until(
    () => client.of(open.sessionId).filter((e) => e.type === "turn.result").length >= 2,
    "o turno da troca",
  );
  await client.call("session.clearPersona", { sessionId: open.sessionId });
  await until(
    () =>
      client
        .of(open.sessionId)
        .some((e) => e.type === "message.user" && e.text.includes("Saia do papel")),
    "a mensagem de saída",
  );
  check(
    client.of(open.sessionId).some((e) => e.type === "persona.cleared"),
    "faltou persona.cleared",
  );
  log("aplicar e voltar ao normal: as duas mensagens e as duas marcas na linha do tempo");
}

async function checkVersionedTrust(client: Client, project: string): Promise<void> {
  step = "persona versionada pede confiança";
  const dir = join(project, ".flightdeck", "personas");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "do-projeto.md"),
    "---\nid: do-projeto\nname: Do projeto\ndescription: Persona do repositório\n---\nVocê é a persona do projeto.\n",
  );
  const untrusted = await client.fail("session.create", {
    cwd: project,
    prompt: "oi",
    persona: { id: "do-projeto" },
  });
  check(untrusted.includes("persona_untrusted"), `devia pedir confiança: ${untrusted}`);
  const project1 = await client.call<Listed>("personas.list", {
    scope: "project",
    projectPath: project,
  });
  const versioned = project1.personas.find((p) => p.id === "do-projeto");
  check(versioned?.hash && !versioned.trusted, "a versionada devia vir com hash e sem confiança");
  await client.call("personas.trust", {
    projectPath: project,
    id: "do-projeto",
    hash: versioned.hash,
  });
  await client.call("session.create", {
    cwd: project,
    prompt: "oi",
    persona: { id: "do-projeto" },
  });
  log("a persona do repositório recusada sem confiança e aceita depois de confiar no hash");
}

function makeWrapper(project: string, configPath: string): Wrapper {
  return async (...args: string[]) => {
    const proc = Bun.spawn([process.execPath, "run", BIN, "claude", ...args], {
      cwd: project,
      env: { ...process.env, FLIGHTDECK_CONFIG: configPath },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: await proc.exited, stderr: await new Response(proc.stderr).text() };
  };
}

async function checkInteractiveWrapper(wrapper: Wrapper, starts: () => FakeStart[]): Promise<void> {
  const done = await wrapper("--persona", "qa");
  check(done.code === 0, `o wrapper devia sair com 0: ${done.code} ${done.stderr}`);
  const start = starts()[0];
  const argv = start?.args ?? [];
  check(
    argv.includes("--append-system-prompt-file") &&
      argv[argv.indexOf("--model") + 1] === "claude-sonnet-5-5",
    `faltou o arquivo do prompt ou o modelo: ${argv.join(" ")}`,
  );
  if (!start?.appended?.includes("engenheiro de QA sênior"))
    throw new Error("o claude devia ver o corpo da persona no arquivo");
  // A Windows runner finds the fake as claude.cmd, a shim that gets no inline --agents.
  if (process.platform === "win32") {
    check(
      !argv.includes("--agents") && done.stderr.includes("--agents"),
      `um claude.cmd não devia receber --agents, e o aviso devia sair: ${done.stderr}`,
    );
  } else {
    const inline = Object.keys(start.agents ?? {});
    check(
      inline.includes("persona-revisor") && inline.includes("persona-do-projeto"),
      `faltaram agentes: ${inline.join(",")}`,
    );
  }
  check(!existsSync(start.appendedPath ?? ""), "o arquivo temporário do corpo devia ter sumido");
}

async function checkPrintWrapper(wrapper: Wrapper, starts: () => FakeStart[]): Promise<void> {
  // Print mode takes the subagents from a file, on every platform.
  const printed = await wrapper("--persona", "qa", "-p", "oi");
  check(printed.code === 0, `o wrapper -p devia sair com 0: ${printed.code} ${printed.stderr}`);
  const print = starts()[1];
  const agentNames = Object.keys(print?.agents ?? {});
  check(
    agentNames.includes("persona-revisor") && agentNames.includes("persona-do-projeto"),
    `faltaram agentes: ${agentNames.join(",")}`,
  );
  check(
    !(existsSync(print?.appendedPath ?? "") || existsSync(print?.agentsPath ?? "")),
    "os arquivos temporários deviam ter sumido",
  );
  log(
    "o claude do terminal recebeu o corpo, o modelo e os subagentes (inline ou por arquivo), e os arquivos sumiram no fim",
  );
}

async function checkWrapper(
  fake: FakeClaudeHandle,
  project: string,
  configPath: string,
): Promise<void> {
  step = "flightdeckd claude --persona";
  const wrapper = makeWrapper(project, configPath);
  const starts = () => fake.events().filter((e) => e.type === "start") as unknown as FakeStart[];
  await checkInteractiveWrapper(wrapper, starts);
  await checkPrintWrapper(wrapper, starts);
  const missing = await wrapper("--persona", "nao-existe");
  check(
    missing.code === 1 && starts().length === 2,
    `uma persona inexistente não devia abrir o claude: ${missing.code} ${missing.stderr}`,
  );
  log("uma persona que não existe não abre o claude");
}

async function run(work: string): Promise<void> {
  const projects = join(work, "projects");
  const project = join(projects, "app");
  mkdirSync(project, { recursive: true });
  const token = crypto.randomUUID().replaceAll("-", "");
  const port = await freePort();
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-personas",
      port,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      hooks: { port: 0, token: "hooks-token-0123456789" },
    }),
  );
  const fake = installFakeClaude([{ do: "exit", code: 0 }]);

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  try {
    const url = await readListenUrl(daemon.stdout);
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    await checkPack(client);
    await checkEditAndReset(client);
    await checkManagedSession(client, project);
    await checkApplyAndClear(client, project);
    await checkVersionedTrust(client, project);
    await checkWrapper(fake, project, configPath);
    client.close();
  } finally {
    fake.restore();
    daemon.kill();
    await daemon.exited;
  }
}

// The real path: on the GitHub runner TEMP is an 8.3 name that the daemon resolves.
const work = realTempDir("flightdeck-smoke-personas-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE PERSONAS OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE PERSONAS FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
