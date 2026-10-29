#!/usr/bin/env bun
/**
 * Workflow smoke: a temp repository with a local remote (`git init --bare`) whose base branch has
 * the example workflow of docs/SPEC-fase-6.md (check pointing to a fake command), a
 * `--runtime fake` daemon and a `github` project answered by a fake `gh`. Trusts the workflow,
 * starts a card with it and runs it whole: plan, gate approved by `gate.respond`, implementation
 * with `[commit]`, a check that fails once and passes the second time, parallel review, PR on
 * the fake `gh`, merge simulated and the card in Concluído.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage, type ServerMessage } from "@flightdeck/protocol";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
  installFakeCheck,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { installFakeCli } from "./test/fake-cli.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

// The daemon gets this environment: neither the real `claude`, `gh` and `az` nor `~/.claude`,
// and its real CheckRunner only reaches the shell for the fake check installed below.
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
const checks = installCheckGuard();
assertCliGuardActive(clis);
assertCheckGuardActive(checks);
// The home guard hides ~/.gitconfig: the FakeRuntime's commits need an identity.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Flightdeck Smoke",
  GIT_AUTHOR_EMAIL: "smoke@flightdeck.invalid",
  GIT_COMMITTER_NAME: "Flightdeck Smoke",
  GIT_COMMITTER_EMAIL: "smoke@flightdeck.invalid",
});

const TIMEOUT_MS = 30_000;
const ROOT = resolve(import.meta.dir, "..");
const PR_URL = "https://github.com/acme/repo/pull/77";
const EXAMPLE = join(ROOT, "apps/daemon/test/fixtures/workflows/feature.yaml");

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

interface Card {
  id: string;
  column: string;
  branch: string | null;
  worktreePath: string | null;
  prUrl: string | null;
  workflowRunId: string | null;
}

interface Run {
  id: string;
  status: string;
  statusReason: string | null;
  usage: { turns: number };
  steps: Array<{ stepId: string; attempt: number; status: string; output: string | null }>;
}

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, fail) =>
      setTimeout(() => fail(new Error(`timeout: ${what}`)), TIMEOUT_MS),
    ),
  ]);
}

async function until<T>(check: () => T | null | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(20);
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
    await this.call("hello", { token, client: "smoke-workflow" });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await withTimeout(ack, `ack de ${type}`);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
  }

  /** Latest `card.updated` of the card that satisfies `check`. */
  card(id: string, check: (card: Card) => boolean): Card | undefined {
    return this.frames
      .flatMap((f) => (f.type === "card.updated" && f.card.id === id ? [f.card as Card] : []))
      .filter(check)
      .at(-1);
  }

  /** Latest `run.updated` of the run that satisfies `check`. */
  run(id: string, check: (run: Run) => boolean): Run | undefined {
    return this.frames
      .flatMap((f) => (f.type === "run.updated" && f.run.id === id ? [f.run as Run] : []))
      .filter(check)
      .at(-1);
  }

  close(): void {
    this.ws.close();
  }
}

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["git", "-c", "core.autocrlf=false", ...args], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
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

/** The spec's example with `bun test` swapped for the fake check and `[commit]` in implement. */
function smokeWorkflow(): string {
  return readFileSync(EXAMPLE, "utf8")
    .replace('check: "bun test"', 'check: "fd-test --all"')
    .replace(
      "Implemente este plano e faça commits:",
      "Implemente este plano e faça commits [commit]:",
    );
}

async function run(work: string): Promise<void> {
  const projects = join(work, "projects");
  const repo = join(projects, "repo");
  mkdirSync(join(repo, ".flightdeck", "workflows"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# smoke\n");
  const yaml = smokeWorkflow();
  if (!yaml.includes("fd-test --all") || !yaml.includes("[commit]")) {
    throw new Error("o exemplo da spec mudou: não deu para montar o workflow do smoke");
  }
  writeFileSync(join(repo, ".flightdeck", "workflows", "feature.yaml"), yaml);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial com o workflow");
  const remote = join(work, "remote.git");
  git(work, "init", "-q", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  // Push only to local remotes: check where origin points before anything is pushed.
  const origin = git(repo, "remote", "get-url", "origin");
  if (origin !== remote || !existsSync(join(origin, "HEAD"))) {
    throw new Error(`origin não é o remoto local: ${origin}`);
  }
  git(repo, "push", "-q", "origin", "main");
  log(`repositório com remoto local ${remote} e o workflow feature na base`);

  // Fakes first on the PATH the daemon gets: the check fails once and passes, then gh.
  const check = installFakeCheck("fd-test", [
    { args: ["--all"], call: 1, stdout: "1 teste falhou", code: 1 },
    { args: ["--all"], stdout: "todos os testes passaram" },
  ]);
  const gh = installFakeCli("gh", [
    { args: ["view", "url"], code: 1 },
    { args: ["pr", "create"], stdout: `${PR_URL}\n` },
    { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state: "OPEN" }) },
  ]);

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-workflow",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      board: { prPollIntervalMs: 200 },
      history: { roots: [join(work, "sem-historico")] },
      hooks: { port: 0 },
    }),
  );

  step = "subir daemon";
  const daemon = Bun.spawn(
    [
      process.execPath,
      "run",
      join(ROOT, "apps/daemon/src/bin.ts"),
      "start",
      "--config",
      configPath,
      "--runtime",
      "fake",
    ],
    // `env` explicitly: PATH with the fakes and the guards, HOME and the check guard.
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "daemon anunciar a porta");
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "cadastrar projeto";
    const project = await client.call<{ id: string }>("project.add", {
      path: repo,
      prProvider: "github",
    });
    await client.call("board.watch", {});
    await client.call("run.watch", {});
    log(`projeto ${project.id} com provedor github`);

    step = "listar e confiar no workflow";
    const { workflows } = await client.call<{
      workflows: Array<{ name: string; hash: string; trusted: boolean; checks: string[] }>;
    }>("workflow.list", { projectId: project.id });
    const feature = workflows.find((w) => w.name === "feature");
    if (!feature) throw new Error(`workflow feature não listado: ${JSON.stringify(workflows)}`);
    if (feature.trusted || feature.checks.join() !== "fd-test --all") {
      throw new Error(`workflow listado errado: ${JSON.stringify(feature)}`);
    }
    await client.call("workflow.trust", {
      projectId: project.id,
      name: "feature",
      hash: feature.hash,
    });
    log(`workflow feature confiado (${feature.hash.slice(0, 12)}…), check: ${feature.checks}`);

    step = "iniciar o card com o workflow";
    const created = await client.call<Card>("card.create", {
      projectId: project.id,
      title: "Somar dois números",
      description: "Função que soma dois números",
    });
    const started = await client.call<Card>("card.start", {
      cardId: created.id,
      workflow: "feature",
      inputs: { task: "uma função que soma dois números" },
    });
    const runId = started.workflowRunId ?? "";
    if (!runId) throw new Error("card.start sem execução de workflow");

    step = "plano e gate";
    const atGate = await until(
      () => client.run(runId, (r) => r.status === "waiting"),
      "gate approve-plan aberto",
    );
    const gate = atGate.steps.find((s) => s.stepId === "approve-plan");
    if (gate?.status !== "waiting" || !gate.output?.includes("Planeje")) {
      throw new Error(`gate inesperado: ${JSON.stringify(gate)}`);
    }
    await until(
      () => client.card(created.id, (c) => c.column === "waiting"),
      "card em Esperando você",
    );
    await client.call("gate.respond", {
      runId,
      stepId: "approve-plan",
      attempt: 1,
      decision: "approve",
      note: "pode seguir",
    });
    log("plano pronto; gate aprovado pelo gate.respond");

    step = "implementação, check, revisão e PR";
    const done = await until(
      () =>
        client.run(
          runId,
          (r) => r.status === "completed" || r.status === "failed" || r.status === "paused",
        ),
      "execução terminar",
    );
    if (done.status !== "completed")
      throw new Error(`execução ${done.status}: ${done.statusReason}`);
    const trail = done.steps.map((s) => `${s.stepId}#${s.attempt}:${s.status}`).join(" ");
    const expected = [
      "plan#1:completed",
      "approve-plan#1:approved",
      "implement#1:completed",
      "tests#1:completed",
      "tests.check#1:failed",
      "tests.do#1:completed",
      "tests.check#2:completed",
      "review#1:completed",
      "review.0#1:completed",
      "review.1#1:completed",
      "apply-review#1:completed",
      "pr#1:completed",
    ].join(" ");
    if (trail !== expected) throw new Error(`etapas inesperadas: ${trail}`);
    if (check.calls().length !== 2) throw new Error(`check rodou ${check.calls().length} vez(es)`);
    log(`etapas: ${trail}`);
    log(`uso: ${done.usage.turns} turnos`);

    step = "conferir o PR";
    const reviewed = await until(
      () => client.card(created.id, (c) => c.prUrl === PR_URL && c.column === "review"),
      "card em Em revisão com o PR",
    );
    const create = gh.calls().find((args) => args.includes("create")) ?? [];
    if (!create.includes(reviewed.branch ?? "?")) {
      throw new Error(`gh pr create recebeu ${JSON.stringify(create)}`);
    }
    if (!git(remote, "branch", "--list", "fd/*").includes(reviewed.branch ?? "?")) {
      throw new Error("a branch não chegou ao remoto local");
    }
    const commits = git(remote, "log", "--oneline", `${reviewed.branch}`, "--not", "main");
    if (!commits.includes("fake:")) throw new Error(`branch sem o commit do agente: ${commits}`);
    log(`PR ${PR_URL} na branch ${reviewed.branch}`);

    step = "simular o merge";
    gh.respond([
      { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state: "MERGED" }) },
    ]);
    await until(
      () => client.card(created.id, (c) => c.column === "done" && c.worktreePath === null),
      "card em Concluído com a worktree removida",
    );
    if (existsSync(reviewed.worktreePath ?? "")) throw new Error("a worktree continua no disco");
    log("Concluído; worktree removida");
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
    gh.restore();
    check.restore();
  }
}

const work = realTempDir("flightdeck-smoke-workflow-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE WORKFLOW OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE WORKFLOW FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
