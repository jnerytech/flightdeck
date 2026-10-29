import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRun } from "@flightdeck/protocol";
import { Board, type BoardOptions } from "../src/board/board.ts";
import type { PrProviderKind } from "../src/board/types.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { SessionManager } from "../src/sessions/session-manager.ts";
import { EventStore } from "../src/store/event-store.ts";
import { git, gitRepo, newBoard } from "./board-helpers.ts";
import { poll } from "./helpers.ts";

/** The example workflow of docs/SPEC-fase-6.md. */
export const EXAMPLE = readFileSync(
  join(import.meta.dir, "fixtures/workflows/feature.yaml"),
  "utf8",
);

/** Writes `.flightdeck/workflows/<name>.yaml` in `cwd` and commits it on the current branch. */
export function commitWorkflow(cwd: string, name: string, yaml: string): void {
  const dir = join(cwd, ".flightdeck", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.yaml`), yaml);
  git(cwd, "add", ".flightdeck/workflows");
  git(cwd, "commit", "-q", "-m", `workflow ${name}`);
}

/** sha256 (hex) of a workflow file, as the daemon computes it. */
export const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/**
 * A board whose repo has `yaml` committed as `.flightdeck/workflows/wf.yaml` on main, already
 * trusted, and a card to start with it.
 */
export async function workflowCard(
  yaml: string,
  options: {
    board?: Partial<BoardOptions>;
    delayMs?: number;
    setupScript?: string;
    /** With a local bare `origin` (pushed to), for `pr` steps. */
    prProvider?: PrProviderKind;
  } = {},
) {
  const ctx = newBoard(options.board ?? {}, options.delayMs ?? 1);
  commitWorkflow(ctx.repo, "wf", yaml);
  const remote = join(ctx.root, "remote.git");
  if (options.prProvider) {
    git(ctx.root, "init", "-q", "--bare", "remote.git");
    git(ctx.repo, "remote", "add", "origin", remote);
    // Push only to local remotes: check where origin points before anything is pushed.
    if (
      git(ctx.repo, "remote", "get-url", "origin") !== remote ||
      !existsSync(join(remote, "HEAD"))
    ) {
      throw new Error("origin não é o remoto local");
    }
    git(ctx.repo, "push", "-q", "origin", "main");
  }
  const project = await ctx.board.addProject({
    path: ctx.repo,
    promptTemplate: "",
    ...(options.setupScript ? { setupScript: options.setupScript } : {}),
    ...(options.prProvider ? { prProvider: options.prProvider } : {}),
  });
  await ctx.board.trustWorkflow(project.id, "wf", sha256(yaml));
  const card = ctx.board.createCard(project.id, { title: "Somar", description: "some" });
  const start = (inputs: Record<string, string> = {}) =>
    ctx.board.startCard(card.id, { workflow: "wf", inputs });
  /** The card's current workflow run, `null` before it has one. */
  const run = (): WorkflowRun | null => {
    const id = ctx.board.getCard(card.id).workflowRunId;
    return id ? ctx.board.workflows.getRun(id) : null;
  };
  /** Polls the run until `check` holds; `null` on timeout, so the `expect` after it fails. */
  const runWhen = (check: (run: WorkflowRun) => boolean, timeoutMs = 5000) =>
    poll(() => {
      const current = run();
      return current && check(current) ? current : null;
    }, timeoutMs);
  /** Allows the oldest open permission request of `sessionId`. */
  const allow = (sessionId: string | null | undefined) => {
    const request = ctx.store.pendingPermissions(sessionId ?? "")[0];
    ctx.manager.respondPermission({ requestId: request?.id ?? "", decision: "allow" });
  };
  return { ...ctx, project, card, start, run, runWhen, allow, remote };
}

/**
 * Like `workflowCard`, but the store is a file and `restart()` stops the daemon (board, sessions
 * and store) and starts a new one on the same file, keeping the FakeRuntime (whose cumulative
 * costs stand for the SDK's across `resume`). Read `host.board` etc. again after each restart.
 */
export async function durableWorkflowCard(yaml: string, options: Partial<BoardOptions> = {}) {
  const { root, repo } = gitRepo();
  commitWorkflow(repo, "wf", yaml);
  const runtime = new FakeRuntime({ delayMs: 1 });
  const open = () => {
    const store = new EventStore(join(root, "flightdeck.db"));
    const manager = new SessionManager({
      store,
      runtime,
      allowedRoots: [root],
      defaultPermissionMode: "default",
      allowApiKey: false,
      baseEnv: {},
    });
    const board = new Board({ db: store.db, manager, allowedRoots: [root], ...options });
    return { store, manager, board };
  };
  const host = { ...open(), runtime, repo, cardId: "", runId: "" };
  const project = await host.board.addProject({ path: repo, promptTemplate: "" });
  await host.board.trustWorkflow(project.id, "wf", sha256(yaml));
  host.cardId = host.board.createCard(project.id, { title: "Somar", description: "x" }).id;
  host.runId = (await host.board.startCard(host.cardId, { workflow: "wf" })).workflowRunId ?? "";
  const restart = async () => {
    host.board.stop();
    await host.manager.shutdown();
    host.store.close();
    Object.assign(host, open());
  };
  const runWhen = (check: (run: WorkflowRun) => boolean, timeoutMs = 5000) =>
    poll(() => {
      const current = host.board.workflows.getRun(host.runId);
      return check(current) ? current : null;
    }, timeoutMs);
  /** The run's step waiting for a permission, once its request is open. */
  const asking = (stepId: string) =>
    runWhen((r) => {
      const step = r.steps.find((s) => s.stepId === stepId);
      return host.store.pendingPermissions(step?.sessionId ?? "").length > 0;
    });
  const allow = (sessionId: string | null | undefined) => {
    const request = host.store.pendingPermissions(sessionId ?? "")[0];
    host.manager.respondPermission({ requestId: request?.id ?? "", decision: "allow" });
  };
  return { host, restart, runWhen, asking, allow, stop: () => host.board.stop() };
}
