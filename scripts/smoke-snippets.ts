#!/usr/bin/env bun
/**
 * Snippets smoke: a `--runtime fake` daemon whose HOME and APPDATA hold only fixture shell
 * histories (the home guard's folder and a temporary one, never the user's). A project has a
 * versioned `.flightdeck/snippets.yaml`: its command cannot run until the file's hash is trusted,
 * but it can be pasted without Enter; a snippet with a secret is refused; a command is pasted into
 * a real PTY running a fixed bun script and echoed back; a prompt is sent to a session; the shell
 * history import hides the lines with secrets, never reads anything outside the fixtures and
 * leaves them untouched.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type Ack, type EventEnvelope, parseServerMessage } from "@flightdeck/protocol";
import { defaultHistorySources } from "../apps/daemon/src/snippets/history.ts";
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

/** The whole of what runs in the terminal: a fixed script that echoes what it reads. */
const SCRIPT = `
console.log("READY");
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

// Secrets made for the smoke, built here so no file of the repository holds one.
const GITHUB = `ghp_${"0123456789abcdef".repeat(2)}0123`;
const SECRETS = [GITHUB, "hunter2hunter2"];

const SNIPPETS_FILE = `- name: testes-rapidos
  type: command
  run: "bun test {{arquivo}}"
  vars: { arquivo: { default: "" } }
- name: revisar-seguranca
  type: prompt
  text: "Revise {{file}} procurando injeção, segredos expostos e validação faltando. Responda em tópicos."
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
  output = new Map<string, string>();
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
      else if (parsed.type === "terminal.data") {
        const text = Buffer.from(parsed.data, "base64").toString("utf8");
        this.output.set(parsed.terminalId, (this.output.get(parsed.terminalId) ?? "") + text);
      }
    });
    await new Promise<void>((ok, fail) => {
      this.ws.addEventListener("open", () => ok(), { once: true });
      this.ws.addEventListener("error", () => fail(new Error("falha ao conectar")), {
        once: true,
      });
    });
    await this.call("hello", { token, client: "smoke-snippets" });
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

interface Snip {
  id: string;
  name: string;
  runnable: boolean;
  source: string;
  type: string;
}

interface Candidate {
  id: string;
  command: string | null;
  hidden: boolean;
  selectable: boolean;
  flagged: string[];
}

async function run(work: string): Promise<void> {
  // Fixture histories, where this daemon will look: the guard's home and a temporary APPDATA.
  const appData = join(work, "appdata");
  const sources = defaultHistorySources({
    home: home.dir,
    appData,
    platform: process.platform,
  });
  const fixtures: Record<string, string> = {
    [sources.bash]: [
      "git status",
      "git status",
      "docker compose up -d",
      `export GITHUB_TOKEN=${GITHUB}`,
      "ls",
      "",
    ].join("\n"),
    [sources.zsh]: [": 1700000000:0;bun test", ": 1700000001:0;bun test", ""].join("\n"),
    [sources.psreadline]: [
      "Get-ChildItem -Recurse",
      "mysql -u root password=hunter2hunter2",
      "",
    ].join("\r\n"),
  };
  for (const [path, content] of Object.entries(fixtures)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const FIXTURE_COMMANDS = new Set([
    "git status",
    "docker compose up -d",
    "bun test",
    "Get-ChildItem -Recurse",
  ]);

  const projects = join(work, "projects");
  const project = join(projects, "app");
  mkdirSync(join(project, ".flightdeck"), { recursive: true });
  writeFileSync(join(project, ".flightdeck", "snippets.yaml"), SNIPPETS_FILE);

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-snippets",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      hooks: { port: 0 },
    }),
  );

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    { env: { ...process.env, APPDATA: appData }, stdout: "pipe", stderr: "inherit" },
  );
  try {
    const url = await readListenUrl(daemon.stdout);
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "snippet do host e segredo recusado";
    await client.call("snippets.save", {
      scope: "host",
      name: "status",
      type: "command",
      run: "git status",
      tags: ["git"],
    });
    const refused = await client.fail("snippets.save", {
      scope: "host",
      name: "com-token",
      type: "command",
      run: `gh auth login --with-token ${GITHUB}`,
    });
    if (!refused.includes("snippet_secret") || refused.includes(GITHUB)) {
      throw new Error(`devia recusar o segredo sem repeti-lo: ${refused}`);
    }
    log(
      "o snippet do host foi salvo e o que tem token foi recusado (snippet_secret), sem repetir o token",
    );

    step = "o arquivo do projeto";
    const listed = await client.call<{
      snippets: Snip[];
      file: { hash: string; trusted: boolean };
    }>("snippets.list", { projectPath: project });
    const byName = Object.fromEntries(listed.snippets.map((s) => [s.name, s]));
    const tests = byName["testes-rapidos"];
    const review = byName["revisar-seguranca"];
    if (!tests || !review || tests.runnable || !review.runnable || listed.file.trusted) {
      throw new Error(
        `o comando do arquivo devia esperar confiança e o prompt não: ${JSON.stringify(listed)}`,
      );
    }
    log("o comando do arquivo versionado espera confiança; o prompt não precisa");

    step = "colar e rodar no terminal";
    const scriptTerminal = async () => {
      const opened = await client.call<{ terminalId: string }>("terminal.open", {
        cwd: project,
        command: [process.execPath, "-e", SCRIPT],
        cols: 100,
        rows: 30,
      });
      await client.call("terminal.attach", { terminalId: opened.terminalId });
      const seen = (text: string) => (client.output.get(opened.terminalId) ?? "").includes(text);
      await until(() => seen("READY"), "o script do terminal");
      return { terminalId: opened.terminalId, seen };
    };
    // Untrusted: it may be pasted without Enter (into a terminal of its own), never run.
    const scratch = await scriptTerminal();
    await client.call("snippets.use", {
      id: tests.id,
      action: "paste",
      terminalId: scratch.terminalId,
    });
    const untrusted = await client.fail("snippets.use", {
      id: tests.id,
      action: "paste",
      terminalId: scratch.terminalId,
      enter: true,
    });
    if (!untrusted.includes("snippet_untrusted"))
      throw new Error(`devia pedir confiança: ${untrusted}`);
    await client.call("snippets.trust", { projectPath: project, hash: listed.file.hash });
    const live = await scriptTerminal();
    const unsafe = await client.fail("snippets.use", {
      id: tests.id,
      action: "paste",
      terminalId: live.terminalId,
      enter: true,
      values: { arquivo: "a.ts\nrm -rf x" },
    });
    if (!unsafe.includes("bad_request"))
      throw new Error(`devia recusar a quebra de linha: ${unsafe}`);
    const ran = await client.call<{ text: string }>("snippets.use", {
      id: tests.id,
      action: "paste",
      terminalId: live.terminalId,
      enter: true,
      values: { arquivo: "x.test.ts" },
    });
    await until(() => live.seen("ECHO:bun test x.test.ts"), "o eco do comando");
    if (ran.text !== "bun test x.test.ts") {
      throw new Error(`o terminal devia ter recebido o comando: ${ran.text}`);
    }
    log(
      "o comando foi colado sem Enter, recusado com Enter sem confiança, e depois da confiança chegou ao terminal",
    );

    step = "enviar o prompt à sessão";
    const { sessionId } = await client.call<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "olá",
      name: "smoke-snippets",
    });
    await client.call("session.subscribe", { sessionId, sinceSeq: 0 });
    await until(
      () => client.events.some((e) => e.event.type === "turn.result"),
      "o primeiro turno",
    );
    const sent = await client.call<{ text: string }>("snippets.use", {
      id: review.id,
      action: "send",
      sessionId,
      context: { file: "src/app.ts" },
    });
    const expected =
      "Revise src/app.ts procurando injeção, segredos expostos e validação faltando. Responda em tópicos.";
    await until(
      () => client.events.some((e) => e.event.type === "message.user" && e.event.text === expected),
      "o prompt chegar à sessão",
    );
    if (sent.text !== expected) throw new Error(`texto inesperado: ${sent.text}`);
    log("o prompt do arquivo, sem confiança, chegou à sessão com {{file}} preenchido");

    step = "importar do histórico";
    const before = Object.keys(fixtures).map((path) => readFileSync(path, "utf8"));
    const preview = await client.call<{
      candidates: Candidate[];
      sources: Array<{ found: boolean }>;
    }>("snippets.importHistory", {});
    const text = JSON.stringify(preview);
    for (const secret of SECRETS) {
      if (text.includes(secret)) throw new Error("a prévia do histórico mostrou um segredo");
    }
    const shown = preview.candidates
      .filter((c) => c.command !== null)
      .map((c) => c.command as string);
    const foreign = shown.filter((command) => !FIXTURE_COMMANDS.has(command));
    if (foreign.length > 0)
      throw new Error(`comando que não é das fixtures: ${foreign.join(" | ")}`);
    const hidden = preview.candidates.filter((c) => c.hidden);
    if (hidden.length !== 2 || hidden.some((c) => c.selectable || c.command !== null)) {
      throw new Error(`as duas linhas com segredo deviam estar ocultas: ${text}`);
    }
    const git = preview.candidates.find((c) => c.command === "docker compose up -d");
    if (!git) throw new Error("faltou docker compose na prévia");
    const imported = await client.call<{
      created: Array<{ name: string; scope: string }>;
      skipped: unknown[];
    }>("snippets.importHistory", { select: [git.id, ...hidden.map((c) => c.id)] });
    if (
      imported.created.length !== 1 ||
      imported.created[0]?.scope !== "host" ||
      imported.skipped.length !== 2
    ) {
      throw new Error(
        `devia importar só o docker compose para o host: ${JSON.stringify(imported)}`,
      );
    }
    const after = Object.keys(fixtures).map((path) => readFileSync(path, "utf8"));
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error("um histórico foi alterado");
    log(
      "o histórico só das fixtures: as 2 linhas com segredo ficaram ocultas e não importáveis, docker compose foi para o host",
    );

    step = "o arquivo versionado não recebe segredo";
    const toFile = await client.fail("snippets.save", {
      scope: "project",
      target: "file",
      projectPath: project,
      name: "com-senha",
      type: "command",
      run: "mysql password=hunter2hunter2",
    });
    if (!toFile.includes("snippet_secret")) throw new Error(`devia recusar no arquivo: ${toFile}`);
    const unchanged = readFileSync(join(project, ".flightdeck", "snippets.yaml"), "utf8");
    if (createHash("sha256").update(unchanged).digest("hex") !== listed.file.hash) {
      throw new Error("o arquivo do projeto mudou");
    }
    log("salvar um segredo no snippets.yaml foi recusado e o arquivo não mudou");
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
  }
}

// The real path: on the GitHub runner TEMP is an 8.3 name that the daemon resolves.
const work = realTempDir("flightdeck-smoke-snippets-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE SNIPPETS OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE SNIPPETS FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
