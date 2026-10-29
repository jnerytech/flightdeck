#!/usr/bin/env bun
/**
 * Automation smoke: a `--runtime fake` daemon, a temporary repository whose origin looks like a
 * GitHub one (pushes go to a local bare repository) and a fake `gh`. An automation `issue_label` →
 * `start_workflow` turns the issue labelled `auto` into a card that runs its workflow; a PR whose
 * checks the fake `gh` turns to failing makes an automation `ci_failed` → `send_to_card` reach the
 * card's session; a terminal session asks for `Bash rm -rf build` (high risk, never automatic),
 * `Read` (approved without AI) and `Write` (approved by the fake AI), with the automatic approval
 * on; an arena of two variants makes two worktrees and choosing `b` removes `a`.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage, type ServerMessage } from "@flightdeck/protocol";
import { installFakeClaude } from "../apps/daemon/test/fake-claude.ts";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { installFakeCli } from "./test/fake-cli.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { assertNoNetwork, installNetworkGuard } from "./test/network-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

// The daemon, the wrapper and the fake claude inherit PATH and HOME: none of the real claude,
// gh, az or ~/.claude is reachable.
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
const network = installNetworkGuard();
const checks = installCheckGuard();
assertCheckGuardActive(checks);
assertCliGuardActive(clis);
// The home guard hides ~/.gitconfig: the commits need an identity.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Flightdeck Smoke",
  GIT_AUTHOR_EMAIL: "smoke@flightdeck.invalid",
  GIT_COMMITTER_NAME: "Flightdeck Smoke",
  GIT_COMMITTER_EMAIL: "smoke@flightdeck.invalid",
});

const TIMEOUT_MS = 20_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");
const GITHUB = "git@github.com:Acme/App.git";
const PR_URL = "https://github.com/acme/app/pull/42";
const SESSION = "dddddddd-0000-4000-8000-000000000013";

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

async function until<T>(
  check: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(30);
  }
}

interface Card {
  id: string;
  column: string;
  branch: string | null;
  worktreePath: string | null;
  sessionId: string | null;
  sessionStatus: string | null;
  workflowRunId: string | null;
  issueRef: string | null;
  arenaVariants: number;
}

interface Variant {
  id: string;
  branch: string | null;
  worktreePath: string | null;
  sessionStatus: string | null;
  queued: boolean;
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
    await this.call("hello", { token, client: "smoke-automation" });
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

  /** Any card with this issue reference that satisfies `check`. */
  cardOfIssue(ref: string, check: (card: Card) => boolean): Card | undefined {
    return this.frames
      .flatMap((f) =>
        f.type === "card.updated" && f.card.issueRef === ref ? [f.card as Card] : [],
      )
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

const ISSUE = {
  number: 7,
  title: "Corrigir o login",
  body: "O login falha",
  url: "https://github.com/Acme/App/issues/7",
  author: { login: "ana" },
  labels: [{ name: "auto" }],
  createdAt: "2026-10-01T10:00:00Z",
  authorAssociation: "MEMBER",
};
const ghRules = (rollup: unknown[] = []) => [
  { args: ["api", "user"], stdout: "eu\n" },
  { args: ["issue", "list"], stdout: JSON.stringify([ISSUE]) },
  { args: ["issue", "view", "7"], stdout: JSON.stringify(ISSUE) },
  { args: ["view", "url"], code: 1 },
  { args: ["pr", "create"], stdout: `${PR_URL}\n` },
  {
    args: ["view", "state,statusCheckRollup"],
    stdout: JSON.stringify({ state: "OPEN", statusCheckRollup: rollup }),
  },
];

async function run(work: string): Promise<void> {
  const projects = join(work, "projects");
  const repo = join(projects, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# smoke\n");
  mkdirSync(join(repo, ".flightdeck", "workflows"), { recursive: true });
  const workflow = "steps:\n  - id: work\n    agent: { prompt: '[commit] faça' }\n";
  writeFileSync(join(repo, ".flightdeck", "workflows", "wf.yaml"), workflow);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  // The origin looks like GitHub's (that is where the issues come from), but every push goes to a
  // local bare repository.
  const remote = join(work, "remote.git").replaceAll("\\", "/");
  git(work, "init", "-q", "--bare", remote);
  git(repo, "remote", "add", "origin", GITHUB);
  git(repo, "config", `url.${remote}.pushInsteadOf`, GITHUB);
  const pushTo = git(repo, "remote", "get-url", "--push", "origin");
  if (pushTo !== remote || !existsSync(join(pushTo, "HEAD"))) {
    throw new Error(`o push não vai ao remoto local: ${pushTo}`);
  }
  git(repo, "push", "-q", "origin", "main");
  log(`repositório com origin ${GITHUB} e push para ${remote}`);

  const gh = installFakeCli("gh", ghRules());

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-automation",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      board: { prPollIntervalMs: 200 },
      hooks: { port: 0 },
      automations: { issuePollIntervalMs: 200 },
      history: { roots: [join(work, "sem-historico")] },
    }),
  );

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    // `env` explicitly: without it the daemon would get the environment from before the guards.
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  const fake = installFakeClaude([
    { do: "session-start", sessionId: SESSION },
    { do: "hook", event: "UserPromptSubmit", payload: { prompt: "limpe e escreva" } },
    {
      do: "hook",
      event: "PermissionRequest",
      payload: { tool_name: "Bash", tool_input: { command: "rm -rf build" } },
    },
    {
      do: "hook",
      event: "PermissionRequest",
      payload: { tool_name: "Read", tool_input: { file_path: "README.md" } },
    },
    {
      do: "hook",
      event: "PermissionRequest",
      payload: { tool_name: "Write", tool_input: { file_path: "a.txt", content: "oi" } },
    },
    { do: "hook", event: "SessionEnd", payload: { reason: "exit" } },
    { do: "exit", code: 0 },
  ]);
  let wrapper: ReturnType<typeof Bun.spawn> | null = null;
  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "daemon anunciar a porta");
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);
    await client.call("board.watch", {});

    step = "cadastrar o projeto e confiar no workflow";
    const project = await client.call<{ id: string }>("project.add", {
      path: repo,
      prProvider: "github",
    });
    const listed = await client.call<{ workflows: Array<{ name: string; hash: string }> }>(
      "workflow.list",
      { projectId: project.id },
    );
    const info = listed.workflows.find((w) => w.name === "wf");
    if (!info) throw new Error("workflow wf não encontrado");
    await client.call("workflow.trust", { projectId: project.id, name: "wf", hash: info.hash });
    await client.call("project.update", {
      projectId: project.id,
      issues: { provider: "github" },
      autoApprove: { enabled: true },
    });

    step = "issue com rótulo vira card e roda o workflow";
    const byIssue = await client.call<{ id: string; enabled: boolean }>("automation.save", {
      projectId: project.id,
      name: "Issues auto",
      trigger: { type: "issue_label", label: "auto" },
      action: { type: "start_workflow", workflow: "wf" },
    });
    if (byIssue.enabled) throw new Error("a automação não nasceu desligada");
    await client.call("automation.toggle", { id: byIssue.id, enabled: true, confirm: true });
    const issueCard = await until(
      () =>
        client.cardOfIssue(
          "github:Acme/App#7",
          (c) => c.workflowRunId !== null && c.column === "review",
        ),
      "card da issue com o workflow rodado",
    );
    const issueRuns = await client.call<{ runs: Array<{ status: string }> }>("automation.runs", {
      id: byIssue.id,
    });
    if (issueRuns.runs.map((r) => r.status).join() !== "ok") {
      throw new Error(`execuções: ${JSON.stringify(issueRuns.runs)}`);
    }
    log(`issue #7 virou o card ${issueCard.id} e rodou o workflow`);

    step = "checks que falham chegam à sessão do card";
    const prCard = await client.call<Card>("card.create", {
      projectId: project.id,
      title: "PR do smoke",
      description: "Crie um arquivo [commit]",
    });
    await client.call("card.start", { cardId: prCard.id });
    const reviewed = await until(
      () => client.card(prCard.id, (c) => c.column === "review" && !!c.sessionId),
      "card do PR em Em revisão",
    );
    await client.call("card.pr.create", { cardId: prCard.id });
    const byCi = await client.call<{ id: string }>("automation.save", {
      projectId: project.id,
      name: "CI falhou",
      trigger: { type: "ci_failed" },
      action: { type: "send_to_card" },
    });
    await client.call("automation.toggle", { id: byCi.id, enabled: true, confirm: true });
    await client.call("session.subscribe", { sessionId: reviewed.sessionId, sinceSeq: 0 });
    gh.respond(ghRules([{ name: "build", conclusion: "FAILURE" }]));
    await until(
      () =>
        client.frames.some(
          (f) =>
            f.type === "event" &&
            f.sessionId === reviewed.sessionId &&
            f.event.type === "message.user" &&
            f.event.text.includes("build"),
        ),
      "mensagem do ci_failed na sessão do card",
    );
    log("o ci_failed chegou à sessão do card com o nome do check");

    step = "aprovação por risco e por IA";
    await client.call("external.watch", {});
    await client.call("hooks.install", { confirm: true });
    wrapper = Bun.spawn([process.execPath, "run", BIN, "claude", "limpe e escreva"], {
      cwd: repo,
      env: { ...process.env, FLIGHTDECK_CONFIG: configPath },
      stdout: "inherit",
      stderr: "inherit",
    });
    const high = await until(
      () =>
        client.frames.find(
          (f) => f.type === "external.permission" && f.state === "open" && f.toolName === "Bash",
        ),
      "pedido do rm -rf como external.permission",
    );
    if (high.type !== "external.permission" || high.risk !== "high") {
      throw new Error(
        `o rm -rf veio como ${high.type === "external.permission" ? high.risk : "?"}`,
      );
    }
    // High risk is never automatic: it waits for you, even with the automatic approval on.
    await Bun.sleep(300);
    const answered = client.frames.some(
      (f) =>
        f.type === "external.permission" && f.requestId === high.requestId && f.state === "closed",
    );
    if (answered) throw new Error("o rm -rf foi respondido sem você");
    await client.call("permission.respond", { requestId: high.requestId, decision: "deny" });
    const closedAuto = await until(
      () =>
        client.frames.filter(
          (f) => f.type === "external.permission" && f.state === "closed" && f.auto,
        ).length >= 2,
      "Read e Write aprovados automaticamente",
    );
    void closedAuto;
    const autos = client.frames.flatMap((f) =>
      f.type === "external.permission" && f.state === "closed" && f.auto
        ? [`${f.toolName}:${f.auto.by}`]
        : [],
    );
    if (autos.join() !== "Read:rule,Write:ai") throw new Error(`aprovações automáticas: ${autos}`);
    const decisions = await client.call<{
      decisions: Array<{ toolName: string; decision: string; by: string }>;
    }>("autoapprove.list", { projectId: project.id });
    const summary = decisions.decisions.map((d) => `${d.toolName}:${d.decision}:${d.by}`).sort();
    if (summary.join() !== "Bash:ask:rule,Read:allow:rule,Write:allow:ai") {
      throw new Error(`registro: ${summary}`);
    }
    log("rm -rf: high, ficou com você; Read sem IA; Write pela IA falsa");
    await withTimeout(wrapper.exited, "flightdeckd claude terminar");

    step = "arena de duas variantes";
    const arenaCard = await client.call<Card>("card.create", {
      projectId: project.id,
      title: "Arena do smoke",
      description: "Crie um arquivo [commit]",
    });
    await client.call("card.startArena", { cardId: arenaCard.id, variants: [{}, {}] });
    const arena = await until(async () => {
      const current = await client.call<{ variants: Variant[] }>("card.arena", {
        cardId: arenaCard.id,
      });
      return current.variants.length === 2 &&
        current.variants.every((v) => !v.queued && v.worktreePath && v.sessionStatus === "idle")
        ? current
        : null;
    }, "as duas variantes prontas");
    const [a, b] = arena.variants as [Variant, Variant];
    if (!existsSync(a.worktreePath as string) || !existsSync(b.worktreePath as string)) {
      throw new Error("faltou uma worktree da arena");
    }
    log(`worktrees ${a.branch} e ${b.branch}`);
    const chosen = await client.call<Card>("card.chooseVariant", {
      cardId: arenaCard.id,
      variantId: b.id,
      confirm: true,
    });
    if (chosen.worktreePath !== b.worktreePath || existsSync(a.worktreePath as string)) {
      throw new Error("a escolha não deixou só a worktree b");
    }
    if (git(repo, "branch", "--list", a.branch as string) !== "") {
      throw new Error("a branch da variante a continua");
    }
    log("escolhida a b: a worktree e a branch da a saíram");

    step = "remover hooks";
    await client.call("hooks.uninstall", { confirm: true });
    client.close();
  } finally {
    wrapper?.kill();
    daemon.kill();
    await daemon.exited;
    fake.restore();
    gh.restore();
  }
}

const work = realTempDir("flightdeck-smoke-automation-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoNetwork(network);
  assertNoRefusedChecks(checks);
  console.log("SMOKE AUTOMATION OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE AUTOMATION FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
