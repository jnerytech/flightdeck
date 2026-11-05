#!/usr/bin/env bun
/**
 * GitHub smoke (phase 37): a `--runtime fake` daemon, a fake `gh` first on the PATH it inherits, and
 * a local bare repository that git reaches through `url.insteadOf`, so no clone touches the network.
 * Sign-in gives a one-time code and can be cancelled, `gh auth status` never leaks a token into an
 * answer, the repos and issues list, an issue becomes a card in a fresh clone inside the allowed
 * root, a second start reuses it, a session opens in the clone, and the refusals carry their reasons.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage } from "@flightdeck/protocol";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
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
const SECRET_TOKEN = "gho_SMOKESECRETTOKENVALUE0123456789";
const CODE = "ABCD-1234";

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

class Client {
  private ws!: WebSocket;
  private readonly acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
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
    await this.call("hello", { token, client: "smoke-github" });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await withTimeout(ack, `ack de ${type}`);
    if (!result.ok) {
      throw new Error(
        `${type}: ${result.error.code} ${result.error.reason ?? ""} ${result.error.message}`.trim(),
      );
    }
    return result.data as T;
  }

  /** The error of a call that should fail: `type: code reason`. */
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
    const match = /listening on (ws:\/\/\S+)/.exec(buffer);
    if (match?.[1]) return match[1];
  }
  throw new Error(`daemon saiu sem anunciar a porta: ${buffer}`);
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

const ghIssue = (n: number) => ({
  number: n,
  title: `Fix the login ${n}`,
  body: `The login breaks, case ${n}`,
  url: `https://github.com/acme/app/issues/${n}`,
  author: { login: "octocat" },
  labels: [{ name: "bug" }],
  createdAt: "2026-10-01T10:00:00Z",
  authorAssociation: "OWNER",
});

async function run(work: string): Promise<void> {
  step = "repositório remoto local";
  const seed = join(work, "seed");
  const remote = join(work, "remote.git");
  mkdirSync(seed, { recursive: true });
  git(seed, "init", "-q", "-b", "main");
  writeFileSync(join(seed, "README.md"), "# app\n");
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "first");
  git(work, "init", "-q", "--bare", "-b", "main", remote);
  git(seed, "push", "-q", remote, "main");
  // Git reaches the "GitHub" address over ssh, and the ssh is this stub: it serves the bare
  // repository, so the clone stays on the disk and `origin` still looks like a GitHub address.
  const sshStub = join(work, "ssh-stub.ts");
  writeFileSync(
    sshStub,
    `const command = process.argv.at(-1) ?? "";
if (!command.startsWith("git-upload-pack")) process.exit(2);
const proc = Bun.spawn(["git", "upload-pack", ${JSON.stringify(remote)}], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await proc.exited);
`,
  );
  const gitConfig = join(work, "gitconfig");
  writeFileSync(
    gitConfig,
    '[url "ssh://git@github.com/acme/app.git"]\n\tinsteadOf = https://github.com/acme/app.git\n',
  );
  process.env.GIT_CONFIG_GLOBAL = gitConfig;
  process.env.GIT_SSH_COMMAND = `${JSON.stringify(process.execPath)} ${JSON.stringify(sshStub)}`;
  log(`o endereço do GitHub vai para ${remote}, por um ssh de mentira`);

  const gh = installFakeCli("gh", [
    {
      args: ["auth", "status"],
      stdout: `github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Token: ${SECRET_TOKEN}\n  - Token scopes: 'repo', 'read:project'\n`,
    },
    {
      args: ["auth", "login"],
      stderr: `! First copy your one-time code: ${CODE}\nOpen https://github.com/login/device\n`,
      delayMs: 60_000,
    },
    { args: ["api", "user"], stdout: "octocat\n" },
    {
      args: ["repo", "list"],
      stdout: JSON.stringify([
        {
          nameWithOwner: "acme/app",
          description: "the app",
          isPrivate: false,
          url: "https://github.com/acme/app",
          updatedAt: "2026-10-01T10:00:00Z",
        },
      ]),
    },
    { args: ["issue", "list"], stdout: JSON.stringify([ghIssue(7)]) },
    { args: ["issue", "view", "7"], stdout: JSON.stringify(ghIssue(7)) },
  ]);

  const projects = join(work, "projects");
  mkdirSync(projects, { recursive: true });
  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-github",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projects],
      runtime: "fake",
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
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  try {
    const url = await readListenUrl(daemon.stdout);
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "o host anuncia github";
    const info = await client.call<{ features: string[] }>("host.info", {});
    if (!info.features.includes("github")) throw new Error("o host devia anunciar github");

    step = "status sem token";
    const status = await client.call<Record<string, unknown>>("github.status", {});
    if (status.loggedIn !== true || status.login !== "octocat" || status.source !== "keyring") {
      throw new Error(`status inesperado: ${JSON.stringify(status)}`);
    }
    if (JSON.stringify(status).includes("gho_")) throw new Error("o status devolveu um token");
    log("o gh está conectado como octocat (chaveiro), e nenhum token aparece na resposta");

    step = "login: código e cancelar";
    const login = await client.call<{ code: string; url: string }>("github.login.start", {});
    if (login.code !== CODE || login.url !== "https://github.com/login/device") {
      throw new Error(`código inesperado: ${JSON.stringify(login)}`);
    }
    await client.call("github.login.cancel", {});
    log("o login deu o código de uso único e foi cancelado");

    step = "repositórios e issues";
    const repos = await client.call<{ repos: Array<{ name: string }> }>("github.repos", {});
    if (repos.repos[0]?.name !== "acme/app") throw new Error("faltou acme/app");
    const issues = await client.call<{ issues: Array<{ ref: string }> }>("github.issues", {
      repo: "acme/app",
    });
    if (issues.issues[0]?.ref !== "github:acme/app#7") throw new Error("faltou a issue 7");
    log("acme/app e a issue 7 vieram da lista");

    step = "a issue vira card, num clone novo";
    const started = await client.call<{
      projectId: string;
      path: string;
      cardId?: string;
      reused: boolean;
    }>("github.start", { repo: "acme/app", issue: "7", root: projects, mode: "card" });
    if (started.path !== join(projects, "app") || started.reused || !started.cardId) {
      throw new Error(`início inesperado: ${JSON.stringify(started)}`);
    }
    if (!existsSync(join(started.path, "README.md"))) throw new Error("o clone não tem o README");
    log(`clonou em ${started.path} e criou o card ${started.cardId}`);

    step = "o segundo início reaproveita";
    const again = await client.call<typeof started>("github.start", {
      repo: "acme/app",
      issue: "7",
      root: projects,
      mode: "card",
    });
    if (!again.reused || again.projectId !== started.projectId || again.cardId !== started.cardId) {
      throw new Error(`devia reaproveitar o clone e o card: ${JSON.stringify(again)}`);
    }
    log("o clone, o projeto e o card foram reaproveitados");

    step = "uma sessão no clone";
    const session = await client.call<{ sessionId?: string }>("github.start", {
      repo: "acme/app",
      issue: "7",
      root: projects,
      mode: "session",
    });
    const sessions = await client.call<{ sessions: Array<{ sessionId: string; cwd: string }> }>(
      "session.list",
      {},
    );
    if (!session.sessionId || !sessions.sessions.some((s) => s.cwd === started.path)) {
      throw new Error(`a sessão devia abrir no clone: ${JSON.stringify(sessions)}`);
    }
    log("a sessão abriu no clone");

    step = "recusas com motivo";
    const outside = await client.fail("github.start", {
      repo: "acme/app",
      root: work,
      mode: "card",
    });
    if (!outside.includes("cwd_outside_roots")) throw new Error(`devia recusar a raiz: ${outside}`);
    const bad = await client.fail("github.issues", { repo: "-R/x" });
    if (!bad.includes("repo_invalid")) throw new Error(`devia recusar o repo: ${bad}`);
    log("uma raiz fora das permitidas e um repo inválido foram recusados, cada um com o motivo");
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
    gh.restore();
  }
}

const work = realTempDir("flightdeck-smoke-github-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE GITHUB OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE GITHUB FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
