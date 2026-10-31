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
];

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

    step = "o pacote";
    const pack = await client.call<Listed>("personas.list", { scope: "host" });
    if (
      pack.personas.map((p) => p.id).join(",") !== PACK.join(",") ||
      pack.personas.some((p) => p.scope !== "pack")
    ) {
      throw new Error(
        `o pacote devia ter as dez, na ordem: ${pack.personas.map((p) => p.id).join(",")}`,
      );
    }
    const english = await client.call<Listed>("personas.list", { scope: "host", language: "en" });
    if (!english.personas.some((p) => p.name === "Security reviewer"))
      throw new Error("faltou o pacote em inglês");
    log("as nove personas do pacote, em pt-BR e em inglês");

    step = "editar e restaurar";
    const secret = `ghp_${"0123456789abcdef".repeat(2)}0123`;
    const refused = await client.fail("personas.save", {
      scope: "host",
      persona: { id: "ruim", name: "Ruim", description: "d", body: `Use ${secret}` },
    });
    if (!refused.includes("persona_secret") || refused.includes(secret)) {
      throw new Error(`devia recusar o segredo sem repeti-lo: ${refused}`);
    }
    await client.call("personas.save", {
      scope: "host",
      persona: { id: "qa", name: "Meu QA", description: "Editada", body: "Seja breve." },
    });
    const edited = await client.call<Listed>("personas.list", { scope: "host" });
    if (!edited.personas.find((p) => p.id === "qa")?.modified)
      throw new Error("a edição devia aparecer como modificada");
    await client.call("personas.reset", { id: "qa" });
    const back = await client.call<Listed>("personas.list", { scope: "host" });
    if (back.personas.find((p) => p.id === "qa")?.scope !== "pack")
      throw new Error("reset devia voltar ao pacote");
    log("um segredo foi recusado sem ser repetido; a edição do pacote foi feita e desfeita");

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
      if (!reply.includes(part))
        throw new Error(`a sessão devia ter aberto no papel (${part}): ${reply}`);
    }
    const listed = await client.call<{
      sessions: Array<{ id: string; permissionMode: string; persona?: { id: string } }>;
    }>("session.list", {});
    const mine = listed.sessions.find((s) => s.id === sessionId);
    if (mine?.persona?.id !== "seguranca" || mine.permissionMode !== "plan") {
      throw new Error(`selo e modo plan esperados: ${JSON.stringify(mine)}`);
    }
    log(
      "a sessão abriu como revisor de segurança: corpo, esforço, ferramentas, subagentes, modo plan e selo",
    );

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
          .some(
            (e) => e.type === "message.user" && e.text.includes("A partir de agora, atue como"),
          ),
      "a mensagem de troca de papel",
    );
    if (!client.of(open.sessionId).some((e) => e.type === "persona.applied"))
      throw new Error("faltou persona.applied");
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
    if (!client.of(open.sessionId).some((e) => e.type === "persona.cleared"))
      throw new Error("faltou persona.cleared");
    log("aplicar e voltar ao normal: as duas mensagens e as duas marcas na linha do tempo");

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
    if (!untrusted.includes("persona_untrusted"))
      throw new Error(`devia pedir confiança: ${untrusted}`);
    const project1 = await client.call<Listed>("personas.list", {
      scope: "project",
      projectPath: project,
    });
    const versioned = project1.personas.find((p) => p.id === "do-projeto");
    if (!versioned?.hash || versioned.trusted)
      throw new Error("a versionada devia vir com hash e sem confiança");
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

    step = "flightdeckd claude --persona";
    const wrapper = async (...args: string[]) => {
      const proc = Bun.spawn([process.execPath, "run", BIN, "claude", ...args], {
        cwd: project,
        env: { ...process.env, FLIGHTDECK_CONFIG: configPath },
        stdout: "pipe",
        stderr: "pipe",
      });
      return { code: await proc.exited, stderr: await new Response(proc.stderr).text() };
    };
    const starts = () =>
      fake.events().filter((e) => e.type === "start") as unknown as Array<{
        args: string[];
        appended: string | null;
        appendedPath: string | null;
        agents: Record<string, { description: string }> | null;
        agentsPath: string | null;
      }>;
    const done = await wrapper("--persona", "qa");
    if (done.code !== 0) throw new Error(`o wrapper devia sair com 0: ${done.code} ${done.stderr}`);
    const start = starts()[0];
    const argv = start?.args ?? [];
    if (
      !argv.includes("--append-system-prompt-file") ||
      argv[argv.indexOf("--model") + 1] !== "claude-sonnet-5-5"
    ) {
      throw new Error(`faltou o arquivo do prompt ou o modelo: ${argv.join(" ")}`);
    }
    if (!start?.appended?.includes("engenheiro de QA sênior"))
      throw new Error("o claude devia ver o corpo da persona no arquivo");
    const agentNames = Object.keys(start.agents ?? {});
    if (!agentNames.includes("persona-revisor") || !agentNames.includes("persona-do-projeto")) {
      throw new Error(`faltaram agentes: ${agentNames.join(",")}`);
    }
    if (existsSync(start.appendedPath ?? "") || existsSync(start.agentsPath ?? "")) {
      throw new Error("os arquivos temporários deviam ter sumido");
    }
    log(
      "o claude do terminal recebeu o corpo, o modelo e os subagentes por arquivos, e eles sumiram no fim",
    );
    const missing = await wrapper("--persona", "nao-existe");
    if (missing.code !== 1 || starts().length !== 1) {
      throw new Error(
        `uma persona inexistente não devia abrir o claude: ${missing.code} ${missing.stderr}`,
      );
    }
    log("uma persona que não existe não abre o claude");
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
