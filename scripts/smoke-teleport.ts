#!/usr/bin/env bun
/**
 * Teleport smoke (#100): two `--runtime fake` daemons, each with its own HOME, allowed root and
 * clone of one `origin`. A session moves from host A to host B and back to A through the app's own
 * relay (`teleportSession`), and each leg checks what the person relies on:
 * - the session lives on the target, idle;
 * - its transcript is there, byte for byte, under the new folder's project;
 * - its code is there: the commit A had over `origin/main`, the edited file and the new one;
 * - the copy it left is archived, and the way back fast-forwards over the copy A kept (set aside,
 *   never lost) and shows it again.
 * The whole run stays under 90 s.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  type Ack,
  type EventEnvelope,
  type HistorySessionSummary,
  parseServerMessage,
} from "@flightdeck/protocol";
import { type TeleportRun, teleportSession } from "../apps/desktop/src/lib/teleport.ts";
import { readListenUrl } from "./lib/smoke-daemon.ts";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

// The daemons inherit this PATH: with the fake runtime, `claude` must never run (docs/TDD.md).
const guard = installClaudeGuard();
// The real `~/.claude` stays untouched: each daemon gets a HOME of its own inside the guarded one.
const home = installHomeGuard();
const checks = installCheckGuard();
assertCheckGuardActive(checks);
const clis = installCliGuard();
assertCliGuardActive(clis);
// The commits this smoke and the daemons make need a name, wherever it runs.
for (const [key, value] of Object.entries({
  GIT_AUTHOR_NAME: "flightdeck-smoke",
  GIT_AUTHOR_EMAIL: "smoke@flightdeck.invalid",
  GIT_COMMITTER_NAME: "flightdeck-smoke",
  GIT_COMMITTER_EMAIL: "smoke@flightdeck.invalid",
})) {
  process.env[key] = value;
}

const TIMEOUT_MS = 20_000;
const BUDGET_MS = 90_000;
const ROOT = resolve(import.meta.dir, "..");
/** The Claude session that moves: a UUID, the only kind of transcript name the daemon reads. */
const SESSION = "5d0c7a3e-2b1f-4e8a-9c6d-7f8e9a0b1c2d";

let step = "prepare";
const log = (msg: string) => console.log(`  · ${msg}`);

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, fail) =>
      setTimeout(() => fail(new Error(`timeout: ${what}`)), TIMEOUT_MS),
    ),
  ]);
}

function git(cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${run.stderr.toString().trim()}`);
  }
  return run.stdout.toString().trim();
}

/** How Claude Code names a folder's project under `~/.claude/projects`. */
const slug = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");

class Client {
  private ws!: WebSocket;
  private readonly acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  readonly events: EventEnvelope[] = [];

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "event") this.events.push(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
      else if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
    });
    await withTimeout(
      new Promise<void>((ok, fail) => {
        this.ws.addEventListener("open", () => ok(), { once: true });
        this.ws.addEventListener("error", () => fail(new Error("could not connect")), {
          once: true,
        });
      }),
      `connect to ${this.url}`,
    );
    await this.call("hello", { token, client: "smoke-teleport" });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await withTimeout(ack, `ack of ${type}`);
    if (!result.ok) {
      const reason = (result.error as { reason?: string }).reason ?? result.error.code;
      throw new Error(`${type}: ${reason} ${result.error.message}`);
    }
    return result.data as T;
  }

  close(): void {
    this.ws.close();
  }
}

interface Host {
  name: string;
  url: string;
  token: string;
  home: string;
  /** This host's clone of the project. */
  repo: string;
  client: Client;
  stop(): Promise<void>;
}

/** The shared `origin`, with one commit on `main`. */
function makeOrigin(work: string): string {
  const seed = join(work, "seed");
  mkdirSync(seed, { recursive: true });
  git(seed, "init", "-q", "-b", "main");
  writeFileSync(join(seed, "README.md"), "# app\n");
  writeFileSync(join(seed, "notes.txt"), "first\n");
  git(seed, "add", "--", "README.md", "notes.txt");
  git(seed, "commit", "-q", "-m", "Start");
  const origin = join(work, "origin.git");
  git(work, "clone", "-q", "--bare", seed, origin);
  return origin;
}

async function startHost(work: string, name: string, origin: string): Promise<Host> {
  const base = join(work, name);
  const roots = join(base, "projects");
  const hostHome = join(base, "home");
  mkdirSync(join(hostHome, ".claude", "projects"), { recursive: true });
  mkdirSync(roots, { recursive: true });
  git(roots, "clone", "-q", origin, "app");
  const repo = join(roots, "app");
  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(base, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: name,
      port: 0,
      token,
      dataDir: join(base, "data"),
      allowedRoots: [roots],
      runtime: "fake",
    }),
  );
  const proc = Bun.spawn(
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
    // Each host reads its own `~/.claude`: the guarded HOME's subfolder for it.
    {
      env: { ...process.env, HOME: hostHome, USERPROFILE: hostHome },
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const stop = async () => {
    proc.kill();
    await proc.exited;
  };
  try {
    const url = await readListenUrl(proc.stdout);
    const client = new Client(url);
    await client.open(token);
    return { name, url, token, home: hostHome, repo, client, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** A's work on the session: a commit `origin` lacks, an edited file and a new one. */
function workOnA(a: Host): void {
  writeFileSync(join(a.repo, "notes.txt"), "first\nsecond, committed on A\n");
  git(a.repo, "add", "--", "notes.txt");
  git(a.repo, "commit", "-q", "-m", "Work on A");
  writeFileSync(join(a.repo, "README.md"), "# app\n\nEdited on A, not committed.\n");
  writeFileSync(join(a.repo, "new.txt"), "untracked, from A\n");
}

/** The session's transcript in A's history, written a while ago so it is not read as in use. */
function transcriptOnA(a: Host): string {
  const folder = join(a.home, ".claude", "projects", slug(a.repo));
  mkdirSync(folder, { recursive: true });
  const ts = new Date(Date.now() - 3_600_000).toISOString();
  const line = (type: "user" | "assistant", uuid: string, text: string) =>
    JSON.stringify({
      type,
      uuid,
      cwd: a.repo,
      sessionId: SESSION,
      timestamp: ts,
      message:
        type === "user"
          ? { role: "user", content: text }
          : { role: "assistant", content: [{ type: "text", text }] },
    });
  const file = join(folder, `${SESSION}.jsonl`);
  writeFileSync(
    file,
    `${[line("user", "u1", "Add a second note"), line("assistant", "a1", "Done.")].join("\n")}\n`,
  );
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(file, past, past);
  return file;
}

async function history(host: Host): Promise<HistorySessionSummary | undefined> {
  const found = await host.client.call<{ sessions: HistorySessionSummary[] }>("history.list", {});
  return found.sessions.find((session) => session.claudeSessionId === SESSION);
}

async function until(check: () => Promise<boolean> | boolean, what: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(100);
  }
}

/** The managed session's status, as the host lists it. */
async function status(host: Host, sessionId: string): Promise<string | null> {
  const listed = await host.client.call<{ sessions: Array<{ id: string; status: string }> }>(
    "session.list",
    {},
  );
  return listed.sessions.find((session) => session.id === sessionId)?.status ?? null;
}

/** The app's relay, from `source` to `target`, saying yes to the summary. */
async function move(source: Host, target: Host, sessionId: string) {
  const request = (host: Host) =>
    ((type: string, payload: unknown) => host.client.call(type, payload)) as TeleportRun["source"];
  const outcome = await teleportSession({
    source: request(source),
    target: request(target),
    sessionId,
    repo: target.repo,
    confirm: async () => true,
  });
  if (outcome.kind !== "moved") throw new Error(`the move ended as ${outcome.kind}`);
  return outcome;
}

/** The code on the target is the source's: the commit, the edit and the new file. */
function sameCode(worktree: string, what: string): void {
  const log = git(worktree, "log", "--format=%s", "-n", "2");
  const readme = readFileSync(join(worktree, "README.md"), "utf8");
  const added = existsSync(join(worktree, "new.txt"));
  if (!log.startsWith("Work on A") || !readme.includes("Edited on A") || !added) {
    throw new Error(
      `${what}: the code did not arrive (log ${JSON.stringify(log)}, new.txt ${added})`,
    );
  }
}

/** The transcript under the target's folder is the one that left, byte for byte. */
function sameTranscript(host: Host, worktree: string, expected: string, what: string): void {
  const file = join(host.home, ".claude", "projects", slug(worktree), `${SESSION}.jsonl`);
  if (!existsSync(file) || readFileSync(file, "utf8") !== expected) {
    throw new Error(`${what}: the transcript is not at ${file} as it left`);
  }
}

async function run(hosts: Host[], work: string): Promise<void> {
  const started = Date.now();
  step = "start two hosts";
  const origin = makeOrigin(work);
  hosts.push(await startHost(work, "host-a", origin), await startHost(work, "host-b", origin));
  const [a, b] = hosts as [Host, Host];
  log(`host-a at ${a.url}, host-b at ${b.url}`);

  step = "both hosts announce teleport";
  for (const host of [a, b]) {
    const info = await host.client.call<{ features?: string[] }>("host.info", {});
    if (!info.features?.includes("teleport")) throw new Error(`${host.name} has no teleport`);
  }

  step = "A's session: its code and its transcript";
  workOnA(a);
  const transcript = readFileSync(transcriptOnA(a), "utf8");
  await until(async () => (await history(a)) !== undefined, "A's history lists the session");

  step = "the session runs on A";
  const resumed = await a.client.call<{ sessionId: string }>("history.resume", {
    claudeSessionId: SESSION,
  });
  await until(async () => (await status(a, resumed.sessionId)) === "idle", "A's session idle");

  step = "A → B";
  const there = await move(a, b, resumed.sessionId);
  log(`moved to ${there.worktree} (${there.branch})`);
  await until(async () => (await status(b, there.sessionId)) === "idle", "B's session idle");
  sameCode(there.worktree, "A → B");
  sameTranscript(b, there.worktree, transcript, "A → B");
  await until(
    async () => (await history(a))?.meta?.archived === true,
    "A archives the copy it left",
  );

  step = "B → A";
  const back = await move(b, a, there.sessionId);
  log(`back at ${back.worktree} (${back.branch})`);
  await until(async () => (await status(a, back.sessionId)) === "idle", "A's session idle again");
  sameCode(back.worktree, "B → A");
  sameTranscript(a, back.worktree, transcript, "B → A");
  const kept = readdirSync(join(a.home, ".claude", "projects", slug(a.repo))).filter((name) =>
    name.startsWith(`${SESSION}.jsonl.replaced-`),
  );
  if (kept.length !== 1) throw new Error(`A's old copy is not set aside once (${kept.length})`);
  await until(async () => (await history(a))?.meta?.archived !== true, "A shows the session again");
  await until(
    async () => (await history(b))?.meta?.archived === true,
    "B archives the copy it left",
  );

  const took = Date.now() - started;
  if (took > BUDGET_MS) throw new Error(`the round trip took ${took} ms, over ${BUDGET_MS}`);
  log(`A → B → A in ${took} ms`);
}

const hosts: Host[] = [];
const work = realTempDir("flightdeck-smoke-teleport-");
let failed = false;
try {
  await run(hosts, work);
} catch (error) {
  failed = true;
  console.error(`smoke-teleport failed at "${step}": ${(error as Error).message}`);
} finally {
  for (const host of hosts) {
    host.client.close();
    await host.stop();
  }
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
assertNoClaudeCalls(guard);
assertHomeGuard(home);
assertNoRefusedChecks(checks);
assertNoCliCalls(clis);
if (failed) process.exit(1);
console.log("smoke-teleport OK");
