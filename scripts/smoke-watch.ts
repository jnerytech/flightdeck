#!/usr/bin/env bun
/**
 * PR watch smoke (phase 22): a temp repository with a local remote, a `--runtime fake` daemon, a
 * `github` project answered by a fake `gh` and a fake local check. A card reaches Em revisão and
 * its PR opens; with the build red the watch starts a round: the fake runtime commits a fix, the
 * local check passes and the push goes to the local remote. The build turns green, the PR merges
 * and the watch stops: a red build afterwards starts no new round.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

// The daemon inherits PATH and HOME: neither the real `claude`, `gh` and `az` nor `~/.claude`.
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
// Only the fake check of this smoke may reach the shell: any other command is refused.
const checks = installCheckGuard();
assertCheckGuardActive(checks);
assertCliGuardActive(clis);
// The home guard hides ~/.gitconfig: the FakeRuntime's commits need an identity.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Flightdeck Smoke",
  GIT_AUTHOR_EMAIL: "smoke@flightdeck.invalid",
  GIT_COMMITTER_NAME: "Flightdeck Smoke",
  GIT_COMMITTER_EMAIL: "smoke@flightdeck.invalid",
});

const TIMEOUT_MS = 15_000;
const ROOT = resolve(import.meta.dir, "..");
const PR_URL = "https://github.com/acme/repo/pull/42";
const RUN = (id: number) => `https://github.com/acme/repo/actions/runs/${id}/job/${id}1`;

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

interface Card {
  id: string;
  column: string;
  branch: string | null;
  worktreePath: string | null;
  prUrl: string | null;
  prState: string | null;
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
  private readonly acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  readonly frames: ServerMessage[] = [];

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
    await this.call("hello", { token, client: "smoke-watch" });
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

interface Watch {
  enabled: boolean;
  status: string;
  reason: string | null;
  rounds: Array<{ n: number; status: string; summary: string | null }>;
}

const ghChecks = (bucket: string, id: number) => ({
  args: ["pr", "checks"],
  stdout: JSON.stringify([{ name: "build", bucket, link: RUN(id) }]),
  ...(bucket === "fail" ? { code: 1 } : {}),
});

/** What the fake `gh` answers while the PR is `state` and its build is `bucket`. */
const ghRules = (state: string, bucket: string, id: number) => [
  ghChecks(bucket, id),
  { args: ["run", "view"], stdout: "ERRO: 3 testes falharam [commit]" },
  { args: ["view", "mergeable"], stdout: JSON.stringify({ mergeable: "MERGEABLE" }) },
  { args: ["view", "reviews"], stdout: JSON.stringify({ reviews: [] }) },
  { args: ["api", "--paginate", "--slurp"], stdout: "[[]]" },
  {
    args: ["graphql"],
    stdout: JSON.stringify({
      data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
    }),
  },
  { args: ["view", "url"], code: 1 },
  { args: ["pr", "create"], stdout: `${PR_URL}\n` },
  { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state }) },
];

/** Asks the watch of the card until a round has pushed. */
async function pushedRound(client: Client, cardId: string) {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const watch = await client.call<Watch>("watch.get", { cardId });
    const round = watch.rounds.find((r) => r.status === "pushed");
    if (round) return round;
    if (watch.status === "needs_you") throw new Error(`a vigia pediu você: ${watch.reason}`);
    if (Date.now() > deadline) throw new Error("timeout: rodada com push");
    await Bun.sleep(100);
  }
}

async function run(work: string): Promise<void> {
  const projects = join(work, "projects");
  const repo = join(projects, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# smoke\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const remote = join(work, "remote.git");
  git(work, "init", "-q", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  // Push only to local remotes: check where origin points before anything is pushed.
  const origin = git(repo, "remote", "get-url", "origin");
  if (origin !== remote || !existsSync(join(origin, "HEAD"))) {
    throw new Error(`origin não é o remoto local: ${origin}`);
  }
  git(repo, "push", "-q", "origin", "main");
  log(`repositório com remoto local ${remote}`);

  const gh = installFakeCli("gh", ghRules("OPEN", "pass", 501));
  const check = installFakeCheck("fd-watch-check", [{ args: [], stdout: "ok" }]);

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-watch",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      board: { prPollIntervalMs: 200 },
      history: { roots: [join(work, "sem-historico")] },
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
    // `env` explicitly: without it the daemon would get the environment from before the guards.
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "daemon anunciar a porta");
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "cadastrar projeto e configurar a vigia";
    const project = await client.call<{ id: string }>("project.add", {
      path: repo,
      prProvider: "github",
    });
    await client.call("board.watch", {});
    await client.call("watch.watch", {});
    const settings = await client.call<{ checks: string[] }>("watch.settings", {
      projectId: project.id,
      patch: { checks: ["fd-watch-check"], maxRounds: 3 },
    });
    if (settings.checks[0] !== "fd-watch-check") throw new Error("os checks não foram guardados");
    const refused = await client
      .call("watch.settings", { projectId: project.id, patch: { checks: ["fd-watch-check; id"] } })
      .then(
        () => false,
        () => true,
      );
    if (!refused) throw new Error("um check com ; foi aceito");
    log("checks guardados; uma linha de shell foi recusada");

    step = "criar o card, revisar e abrir o PR";
    const created = await client.call<Card>("card.create", {
      projectId: project.id,
      title: "Arquivo do smoke",
      description: "Crie um arquivo e faça commit [commit]",
    });
    await client.call("card.start", { cardId: created.id });
    const reviewed = await until(
      () => client.card(created.id, (c) => c.column === "review"),
      "card em Em revisão",
    );
    const opened = await client.call<Card>("card.pr.create", { cardId: created.id });
    if (opened.prUrl !== PR_URL) throw new Error(`PR com URL ${opened.prUrl}`);
    await client.call("watch.set", { cardId: created.id, enabled: true });
    log(`PR ${opened.prUrl} vigiado`);

    step = "build vermelho: uma rodada de conserto";
    gh.respond(ghRules("OPEN", "fail", 502));
    const round = await pushedRound(client, created.id);
    if (!round.summary?.includes("checks passed: fd-watch-check")) {
      throw new Error(`resumo da rodada: ${round.summary}`);
    }
    if (check.calls().length === 0) throw new Error("o check local não rodou");
    const ahead = git(remote, "rev-list", "--count", `main..${reviewed.branch}`);
    if (Number(ahead) < 2) throw new Error(`o remoto local tem ${ahead} commit(s) à frente`);
    log(`rodada ${round.n}: ${round.summary}`);

    step = "build verde e PR concluído: a vigia para";
    gh.respond(ghRules("MERGED", "pass", 502));
    await until(
      () => client.card(created.id, (c) => c.column === "done" && c.worktreePath === null),
      "card em Concluído",
    );
    gh.respond(ghRules("MERGED", "fail", 503));
    await Bun.sleep(1200);
    const final = await client.call<Watch>("watch.get", { cardId: created.id });
    if (final.rounds.length !== 1) {
      throw new Error(`a vigia continuou: ${final.rounds.length} rodadas`);
    }
    log("PR concluído: nenhuma rodada nova");
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
    gh.restore();
    check.restore();
  }
}

const work = realTempDir("flightdeck-smoke-watch-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE WATCH OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE WATCH FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
