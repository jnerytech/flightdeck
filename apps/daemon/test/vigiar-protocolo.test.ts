import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { runCli } from "../src/main.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(100_000);

const TOKEN = "vigiar-protocolo-token-0123456789abcdef";
const WEB = "https://dev.azure.com/acme/proj/_git/repo";
const PR = `${WEB}/pullrequest/9`;

/** Asks again until the answer is something, or the time is up (`null`). */
async function until<T>(
  check: () => Promise<T | null | false>,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await Bun.sleep(20);
  }
}

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** What the fake Azure host answers while the build of the PR is red (or green). */
function azRules(build: "rejected" | "approved"): FakeRule[] {
  return [
    { args: ["repos", "pr", "list"], stdout: "[]" },
    {
      args: ["repos", "pr", "create"],
      stdout: JSON.stringify({ pullRequestId: 9, repository: { webUrl: WEB } }),
    },
    {
      args: ["repos", "pr", "policy", "list"],
      stdout: JSON.stringify([{ status: build }]),
    },
    {
      args: ["repos", "pr", "show"],
      stdout: JSON.stringify({
        status: "active",
        mergeStatus: "succeeded",
        repository: { project: { id: "proj-guid", name: "proj" }, webUrl: WEB },
      }),
    },
    {
      args: ["evaluations"],
      stdout: JSON.stringify({
        value: [
          {
            status: build,
            configuration: { type: { displayName: "Build" }, settings: { displayName: "CI" } },
            context: { buildId: 88 },
          },
        ],
      }),
    },
    { args: ["pullRequestThreads"], stdout: '{"value":[]}' },
    {
      args: ["timeline"],
      stdout: JSON.stringify({
        records: [{ type: "Task", name: "Run tests", result: "failed", log: { id: 12 } }],
      }),
    },
    { args: ["logId=12"], stdout: "ERRO: 3 testes falharam" },
  ];
}

/** A daemon with a project, a card whose branch is pushed, and a fake az on PATH. */
async function boot() {
  const az: FakeCli = installFakeCli("az", azRules("approved"));
  cleanups.push(az.restore);
  const { root, repo } = gitRepo();
  git(root, "init", "-q", "--bare", "remote.git");
  git(repo, "remote", "add", "origin", join(root, "remote.git"));
  git(repo, "push", "-q", "origin", "main");
  const dir = tempDir("fd-vigiar-");
  const file = join(dir, "config.json");
  await Bun.write(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      hooks: { port: 0 },
      allowedRoots: [root],
      board: { prPollIntervalMs: 400 },
    }),
  );
  const daemon = await runCli(["--config", file, "--runtime", "fake"], {
    env: {},
    log: { log: () => {}, error: () => {} },
    exit: () => {},
    onSignal: () => {},
  });
  cleanups.push(() => daemon?.stop());
  const client = new FrameClient(daemon?.url ?? "");
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  const project = await client.data<{ id: string }>("project.add", {
    path: repo,
    prProvider: "azure-devops",
    promptTemplate: "",
  });
  const card = await client.data<{ id: string }>("card.create", {
    projectId: project?.id,
    title: "Login",
    description: "Fazer o login",
  });
  await client.request("card.start", { cardId: card?.id });
  await until(async () => {
    const got = await client.data<{ column: string }>("card.get", { cardId: card?.id });
    return got?.column === "review" ? got : null;
  }, 10_000);
  const cardId = card?.id ?? "";
  return { az, client, daemon, projectId: project?.id ?? "", cardId, repo };
}

interface Watch {
  cardId: string;
  enabled: boolean;
  status: string;
  reason: string | null;
  rounds: Array<{ n: number; status: string; trigger: { failed: string[] } }>;
}

describe("vigiar-protocolo: the watch over the protocol", () => {
  test("the daemon announces it, and the settings are read, validated and kept per project", async () => {
    const { client, projectId } = await boot();
    const info = await client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features).toContain("watch");
    const defaults = await client.data<Record<string, unknown>>("watch.settings", { projectId });
    expect(defaults).toMatchObject({ enabled: false, maxRounds: 3, persona: "revisor" });
    const patched = await client.data<Record<string, unknown>>("watch.settings", {
      projectId,
      patch: { enabled: true, maxRounds: 2, checks: ["bun test"] },
    });
    expect(patched).toMatchObject({ enabled: true, maxRounds: 2, checks: ["bun test"] });
    expect(await client.data("watch.settings", { projectId })).toEqual(patched);
    for (const patch of [{ maxRounds: 0 }, { persona: "" }, { dailyUsd: -1 }, { extra: 1 }]) {
      expect(await client.request("watch.settings", { projectId, patch })).toMatchObject({
        ok: false,
        error: { code: "bad_request" },
      });
    }
    expect(await client.request("watch.settings", { projectId: "nao-existe" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  test("a card's watch is turned on and off, and read with its status and rounds", async () => {
    const { client, cardId } = await boot();
    expect(await client.data<Watch>("watch.get", { cardId })).toMatchObject({
      cardId,
      enabled: false,
      status: "watching",
      reason: null,
      rounds: [],
    });
    expect(await client.data<Watch>("watch.set", { cardId, enabled: true })).toMatchObject({
      enabled: true,
    });
    expect(await client.data<Watch>("watch.set", { cardId, enabled: null })).toMatchObject({
      enabled: false,
    });
    expect(await client.request("watch.get", { cardId: "nao-existe" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  test("with the build red, the daemon watches by itself: it fixes, finds no commit, and the card asks for you", async () => {
    const { az, client, cardId } = await boot();
    await client.request("watch.watch", {});
    const opened = await client.data<{ prUrl: string }>("card.pr.create", { cardId });
    expect(opened?.prUrl).toBe(PR);
    await client.data("watch.set", { cardId, enabled: true });
    az.respond(azRules("rejected"));
    const watch = await until(async () => {
      const got = await client.data<Watch>("watch.get", { cardId });
      return got?.status === "needs_you" ? got : null;
    }, 90_000);
    expect(watch?.rounds[0]).toMatchObject({ n: 1, status: "failed", trigger: { failed: ["CI"] } });
    expect(watch?.reason).toContain("no commit");
    // The frame told the app each change of the watch.
    const updates = client.frames.filter((f) => f.type === "watch.updated");
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.at(-1)).toMatchObject({ watch: { cardId, status: "needs_you" } });
    // The trail: the card's run and the fixing session, found by the PR link.
    const trace = await client.data<{ sessions: Array<{ kind: string }>; prUrl: string }>(
      "watch.trace",
      { cardId },
    );
    expect(trace?.sessions.map((s) => s.kind)).toEqual(["run", "fix"]);
    const found = await client.data<{ via: string; trace: { cardId: string } }>("watch.byUrl", {
      url: `${PR}?_a=overview`,
    });
    expect(found).toMatchObject({ via: "card", trace: { cardId } });
    expect(await client.data("watch.byUrl", { url: `${WEB}/pullrequest/77` })).toMatchObject({
      via: "none",
    });
  });

  test("the description is offered for the person to edit, and the PR opens only with what is confirmed", async () => {
    const { az, client, cardId } = await boot();
    const offered = await client.data<{ text: string; redacted: number }>("watch.describe", {
      cardId,
    });
    expect(offered?.text).toContain("Login");
    expect(offered?.redacted).toBe(0);
    // Offering it opens nothing.
    expect(az.calls().some((args) => args.includes("create"))).toBe(false);
    expect(await client.request("watch.describe", { cardId: "nao-existe" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    const secret = await client.request("card.pr.create", {
      cardId,
      description: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(secret).toMatchObject({ ok: false, error: { code: "bad_request" } });
    expect(az.calls().some((args) => args.includes("create"))).toBe(false);
    await client.data("card.pr.create", { cardId, description: `${offered?.text} (editado)` });
    const create = az.calls().find((args) => args.includes("create")) ?? [];
    expect(create[create.indexOf("--description") + 1]).toContain("(editado)");
  });
});
