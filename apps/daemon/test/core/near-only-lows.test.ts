import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Automations } from "../../src/automations/automations.ts";
import { personaHash } from "../../src/personas/domain/model.ts";
import { Personas } from "../../src/personas/store.ts";
import { Changes } from "../../src/review/changes.ts";
import { ReviewFiles } from "../../src/review/files.ts";
import { startServer } from "../../src/server.ts";
import { SecretScanner } from "../../src/snippets/domain/model.ts";
import { SshTargets } from "../../src/ssh/targets.ts";
import { EventStore } from "../../src/store/event-store.ts";
import type { DaemonUpdater } from "../../src/updates/apply.ts";
import { SECURITY } from "../personas/model-setup.ts";
import { git, newBoard } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { insertSession } from "../support/usage-helpers.ts";

// Real git in a temporary repository: more than the default 5 s.
setDefaultTimeout(30_000);

const TOKEN = "near-lows-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Issue #3815: a handler that enables, loosens, installs or runs needs a near connection (this
 * computer or Tailscale), as trusting a workflow does; the same handler turning a thing off, or
 * tightening it, answers anywhere.
 */
async function nearAndFar() {
  const { board, manager, store, repo, root } = newBoard();
  const project = await board.addProject({ path: repo });
  git(repo, "config", "commit.gpgsign", "false");
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, ".claude", "settings.json"), "{}\n");
  writeFileSync(join(repo, "a.txt"), "original\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first");
  insertSession(store.db, "m-1", "s-1", repo);
  const files = new ReviewFiles({
    changes: new Changes({ db: store.db }),
    dataDir: tempDir("fd-data-"),
    allowedRoots: [root],
  });
  const ssh = new SshTargets({ db: new EventStore(":memory:").db });
  const personas = new Personas({
    db: new EventStore(":memory:").db,
    allowedRoots: [root],
    scanner: new SecretScanner(),
  });
  const applied: unknown[] = [];
  const updater = {
    apply: async (confirm: boolean) => {
      applied.push(confirm);
      return { started: true };
    },
  } as unknown as DaemonUpdater;
  const toggled: unknown[] = [];
  const automations = {
    toggle: (id: string, enabled: boolean) => {
      toggled.push([id, enabled]);
      return { id, enabled };
    },
  } as unknown as Automations;
  const base = {
    manager,
    board,
    review: { files },
    ssh: { targets: ssh },
    personas: { store: personas },
    updates: { apply: updater },
    automations,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
    allowedNetworks: ["0.0.0.0/0", "::/0"],
  };
  const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
  const clients = servers.map((server) => new FrameClient(server.url));
  cleanups.push(async () => {
    for (const client of clients) client.close();
    for (const server of servers) await server.stop();
    await board.stop();
  });
  for (const client of clients) await client.request("hello", { token: TOKEN, client: "t" });
  const [near, far] = clients as [FrameClient, FrameClient];
  const reasonOf = async (call: Promise<{ error?: unknown }>) =>
    ((await call).error as { reason?: string } | undefined)?.reason ?? null;
  return { near, far, board, project, repo, applied, toggled, personas, reasonOf };
}

describe("applying a daemon update needs a near connection (#3815)", () => {
  test("a far connection is refused and nothing is applied; a near one applies", async () => {
    const { near, far, applied, reasonOf } = await nearAndFar();
    const farApply = await reasonOf(far.request("daemon.update.apply", { confirm: true }));
    const afterFar = [...applied];
    const nearApply = await reasonOf(near.request("daemon.update.apply", { confirm: true }));
    expect([farApply, afterFar, nearApply, applied]).toEqual([
      "transport_refused",
      [],
      null,
      [true],
    ]);
  });
});

describe("a project's automatic approval: turning it on needs a near connection (#3815)", () => {
  test("a far connection cannot turn it on or loosen it, can turn it off; a near one can", async () => {
    const { near, far, board, project, reasonOf } = await nearAndFar();
    const auto = () => board.getProject(project.id).autoApprove;
    const farOn = await reasonOf(
      far.request("project.update", { projectId: project.id, autoApprove: { enabled: true } }),
    );
    const farLoose = await reasonOf(
      far.request("project.update", { projectId: project.id, autoApprove: { lowWithoutAi: true } }),
    );
    const afterFar = auto().enabled;
    const farAdd = await reasonOf(
      far.request("project.add", { path: project.path, autoApprove: { enabled: true } }),
    );
    const nearOn = await reasonOf(
      near.request("project.update", { projectId: project.id, autoApprove: { enabled: true } }),
    );
    const afterNear = auto().enabled;
    const farOff = await reasonOf(
      far.request("project.update", {
        projectId: project.id,
        autoApprove: { enabled: false, lowWithoutAi: false },
      }),
    );
    const farRename = await reasonOf(
      far.request("project.update", { projectId: project.id, name: "renamed" }),
    );
    expect([farOn, farLoose, afterFar, farAdd, nearOn, afterNear, farOff, farRename]).toEqual([
      "transport_refused",
      "transport_refused",
      false,
      "transport_refused",
      null,
      true,
      null,
      null,
    ]);
    expect(auto()).toMatchObject({ enabled: false, lowWithoutAi: false });
  });
});

describe("saving an ssh target with ForwardAgent needs a near connection (#3815)", () => {
  test("a far connection cannot turn it on, can save without it; a near one can", async () => {
    const { near, far, reasonOf } = await nearAndFar();
    const target = { name: "vps", host: "vps.example.com", user: "deploy" };
    const farOn = await reasonOf(
      far.request("ssh.save", { ...target, options: { forwardAgent: true }, confirm: true }),
    );
    const farPlain = await reasonOf(far.request("ssh.save", target));
    const farOff = await reasonOf(
      far.request("ssh.save", { ...target, options: { forwardAgent: false } }),
    );
    const nearOn = await reasonOf(
      near.request("ssh.save", {
        ...target,
        name: "vps2",
        options: { forwardAgent: true },
        confirm: true,
      }),
    );
    expect([farOn, farPlain, farOff, nearOn]).toEqual(["transport_refused", null, null, null]);
    expect(((await far.data("ssh.list", {})) as { targets: unknown[] }).targets).toHaveLength(2);
  });
});

describe("turning an automation on needs a near connection (#3815)", () => {
  test("a far connection cannot turn one on, can turn one off; a near one turns it on", async () => {
    const { near, far, toggled, reasonOf } = await nearAndFar();
    const farOn = await reasonOf(
      far.request("automation.toggle", { id: "a1", enabled: true, confirm: true }),
    );
    const afterFar = [...toggled];
    const farOff = await reasonOf(far.request("automation.toggle", { id: "a1", enabled: false }));
    const nearOn = await reasonOf(
      near.request("automation.toggle", { id: "a1", enabled: true, confirm: true }),
    );
    expect([farOn, afterFar, farOff, nearOn, toggled]).toEqual([
      "transport_refused",
      [],
      null,
      null,
      [
        ["a1", false],
        ["a1", true],
      ],
    ]);
  });
});

describe("writing Claude Code's settings through file.write needs a near connection (#3815)", () => {
  test("a far connection cannot write them, however the path is spelled or linked; any other file it can", async () => {
    const { near, far, repo, reasonOf } = await nearAndFar();
    symlinkSync(join(repo, ".claude", "settings.json"), join(repo, "link.json"));
    const target = "session:s-1";
    const hook =
      '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"touch pwned"}]}]}}\n';
    const write = (client: FrameClient, path: string, expectedHash: string) =>
      reasonOf(client.request("file.write", { target, path, text: hook, expectedHash }));
    const settings = () => readFileSync(join(repo, ".claude", "settings.json"), "utf8");
    const farReasons = [
      await write(far, ".claude/settings.json", sha("{}\n")),
      await write(far, "./.Claude//Settings.json", sha("{}\n")),
      await write(far, ".claude\\settings.json", sha("{}\n")),
      await write(far, "link.json", sha("{}\n")),
    ];
    const afterFar = settings();
    const farOther = await write(far, "a.txt", sha("original\n"));
    const nearSettings = await write(near, ".claude/settings.json", sha("{}\n"));
    expect([farReasons, afterFar, farOther, nearSettings, settings()]).toEqual([
      Array(4).fill("transport_refused"),
      "{}\n",
      null,
      null,
      hook,
    ]);
  });
});

describe("trusting a project's persona needs a near connection (#3815)", () => {
  test("a far connection cannot trust one; a near one can", async () => {
    const { near, far, repo, personas, reasonOf } = await nearAndFar();
    const dir = join(repo, ".flightdeck", "personas");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "seguranca.md"), SECURITY);
    const ask = { projectPath: repo, id: "seguranca", hash: personaHash(SECURITY) };
    const trusted = async () =>
      (await personas.list({ scope: "project", projectPath: repo })).personas[0]?.trusted;
    const before = await trusted();
    const farTrust = await reasonOf(far.request("personas.trust", ask));
    const afterFar = await trusted();
    const nearTrust = await reasonOf(near.request("personas.trust", ask));
    expect([before, farTrust, afterFar, nearTrust, await trusted()]).toEqual([
      false,
      "transport_refused",
      false,
      null,
      true,
    ]);
  });
});
