import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Automations } from "../../src/automations/automations.ts";
import { DEFAULT_PROMPT_TEMPLATE } from "../../src/board/board.ts";
import { ProjectMemory } from "../../src/memory/memory.ts";
import { personaHash } from "../../src/personas/domain/model.ts";
import { Personas } from "../../src/personas/store.ts";
import { Changes } from "../../src/review/changes.ts";
import { ReviewFiles } from "../../src/review/files.ts";
import { startServer } from "../../src/server.ts";
import { SecretScanner } from "../../src/snippets/domain/model.ts";
import { SshTargets } from "../../src/ssh/targets.ts";
import { EventStore } from "../../src/store/event-store.ts";
import type { DaemonUpdater } from "../../src/updates/apply.ts";
import { requireVaultTransport } from "../../src/vault/index.ts";
import { SECURITY } from "../personas/model-setup.ts";
import { SECURITY as HOST_PERSONA } from "../personas/subagent-setup.ts";
import { git, newBoard } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { slugOf } from "../support/memory.ts";
import { insertSession } from "../support/usage-helpers.ts";

// Real git in a temporary repository: more than the default 5 s.
setDefaultTimeout(30_000);

const TOKEN = "near-lows-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

interface SavedTarget {
  name: string;
  host?: string;
  port?: number;
  user?: string;
  options?: { forwardAgent?: boolean };
}

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
  const published: string[] = [];
  const personas = new Personas({
    db: new EventStore(":memory:").db,
    allowedRoots: [root],
    scanner: new SecretScanner(),
    publisher: {
      publish: async (request) => {
        published.push(request.name);
        return { path: `.claude/agents/${request.name}.md` };
      },
    },
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
  const claudeDir = tempDir("fd-claude-");
  const memoryDir = join(claudeDir, "projects", slugOf(repo), "memory");
  const base = {
    manager,
    board,
    agentSetup: { memory: new ProjectMemory({ claudeDir }) },
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
  return {
    near,
    far,
    board,
    project,
    repo,
    memoryDir,
    applied,
    toggled,
    personas,
    published,
    reasonOf,
  };
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
    // What the CLI sends with a change: the stored values back, so nothing is loosened.
    const farSame = await reasonOf(
      far.request("project.update", {
        projectId: project.id,
        autoApprove: { ...auto(), enabled: false },
      }),
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
    // On, with low risk asked to the AI: a far connection cannot make low risk skip it.
    const nearStrict = await reasonOf(
      near.request("project.update", {
        projectId: project.id,
        autoApprove: { enabled: true, lowWithoutAi: false },
      }),
    );
    const farLoose = await reasonOf(
      far.request("project.update", {
        projectId: project.id,
        autoApprove: { enabled: true, lowWithoutAi: true },
      }),
    );
    const afterLoose = auto().lowWithoutAi;
    // A bare off, which the protocol fills with its defaults, is no loosening.
    const farBareOff = await reasonOf(
      far.request("project.update", { projectId: project.id, autoApprove: { enabled: false } }),
    );
    expect([
      farOn,
      farSame,
      afterFar,
      farAdd,
      nearOn,
      afterNear,
      farOff,
      farRename,
      nearStrict,
      farLoose,
      afterLoose,
      farBareOff,
    ]).toEqual([
      "transport_refused",
      null,
      false,
      "transport_refused",
      null,
      true,
      null,
      null,
      null,
      "transport_refused",
      false,
      null,
    ]);
    expect(auto().enabled).toBe(false);
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
    const forwarding = (
      (await far.data("ssh.list", {})) as { targets: Array<SavedTarget & { id: string }> }
    ).targets.find((t) => t.name === "vps2");
    // An edit that leaves ForwardAgent on and the server as it was, as the app and the CLI send it,
    // is no turning it on.
    const keep = { ...target, id: forwarding?.id, options: { forwardAgent: true } };
    const farKeep = await reasonOf(far.request("ssh.save", { ...keep, name: "vps2" }));
    // Pointing a target that forwards the agent somewhere else hands the agent to that place.
    const farHost = await reasonOf(
      far.request("ssh.save", { ...keep, name: "vps2", host: "attacker.example.com" }),
    );
    const farPort = await reasonOf(far.request("ssh.save", { ...keep, name: "vps2", port: 2222 }));
    const farUser = await reasonOf(
      far.request("ssh.save", { ...keep, name: "vps2", user: "root" }),
    );
    expect([farOn, farPlain, farOff, nearOn, farKeep, farHost, farPort, farUser]).toEqual([
      "transport_refused",
      null,
      null,
      null,
      null,
      "transport_refused",
      "transport_refused",
      "transport_refused",
    ]);
    const saved = ((await far.data("ssh.list", {})) as { targets: SavedTarget[] }).targets;
    expect(saved.filter((t) => t.options?.forwardAgent === true).map((t) => t.name)).toEqual([
      "vps2",
    ]);
    expect(saved).toHaveLength(3);
    expect(saved.find((t) => t.name === "vps2")).toMatchObject({
      host: "vps.example.com",
      port: 22,
      user: "deploy",
    });
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
    // A settings file that is not there yet, reached through a link to its folder.
    symlinkSync(join(repo, ".claude"), join(repo, "via"));
    const missing = join(repo, ".claude", "settings.local.json");
    const farMissing = await write(far, "via/settings.local.json", "0".repeat(64));
    // What shapes a session as a settings file does: agents, skills, commands, rules, any CLAUDE.md,
    // and a `.claude` folder deeper in the repository.
    const config = [
      ".claude/agents/new.md",
      ".claude/skills/x/SKILL.md",
      ".claude/commands/go.md",
      "CLAUDE.md",
      "docs/CLAUDE.local.md",
      "apps/web/.claude/settings.json",
    ];
    const farConfig: Array<string | null> = [];
    for (const path of config) farConfig.push(await write(far, path, "0".repeat(64)));
    const farOther = await write(far, "a.txt", sha("original\n"));
    const nearSettings = await write(near, ".claude/settings.json", sha("{}\n"));
    expect([
      farReasons,
      afterFar,
      farMissing,
      existsSync(missing),
      farConfig,
      farOther,
      nearSettings,
      settings(),
    ]).toEqual([
      Array(4).fill("transport_refused"),
      "{}\n",
      "transport_refused",
      false,
      config.map(() => "transport_refused"),
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

describe("publishing a persona as a project agent needs a near connection (#3815)", () => {
  test("a far connection is refused and nothing is written; a near one publishes", async () => {
    const { near, far, repo, personas, published, reasonOf } = await nearAndFar();
    await personas.save({ scope: "host", persona: HOST_PERSONA });
    const ask = { id: "seg", projectPath: repo, confirm: true };
    const farPublish = await reasonOf(far.request("personas.publishAgent", ask));
    const afterFar = [...published];
    const nearPublish = await reasonOf(near.request("personas.publishAgent", ask));
    expect([farPublish, afterFar, nearPublish, published]).toEqual([
      "transport_refused",
      [],
      null,
      ["persona-seg"],
    ]);
  });
});

/**
 * Issue #3825: what #3815 left open. Each call that enables, loosens, installs or runs something is
 * refused from a far connection; the direction that only disables or restricts stays open.
 */
describe("a project's auto memory needs a near connection to change (#3825)", () => {
  test("a far connection cannot write or delete a memory file; a near one can", async () => {
    const { near, far, project, memoryDir, reasonOf } = await nearAndFar();
    const note = { projectId: project.id, name: "a.md", content: "x\n", confirm: true };
    const farWrite = await reasonOf(far.request("memory.write", { ...note, expectedHash: null }));
    const afterFar = existsSync(join(memoryDir, "a.md"));
    const nearWrite = await reasonOf(near.request("memory.write", { ...note, expectedHash: null }));
    const del = { projectId: project.id, name: "a.md", expectedHash: sha("x\n"), confirm: true };
    const farDelete = await reasonOf(far.request("memory.delete", del));
    const stillThere = existsSync(join(memoryDir, "a.md"));
    const nearDelete = await reasonOf(near.request("memory.delete", del));
    expect([farWrite, afterFar, nearWrite, farDelete, stillThere, nearDelete]).toEqual([
      "transport_refused",
      false,
      null,
      "transport_refused",
      true,
      null,
    ]);
  });
});

describe("updating a card from its base and merging it locally need a near connection (#3825)", () => {
  test("a far connection is refused before the card is looked at; a near one reaches it", async () => {
    const { near, far, reasonOf } = await nearAndFar();
    const merge = { cardId: "nope", mode: "squash", confirm: true } as const;
    const farUpdate = await reasonOf(far.request("card.updateFromBase", { cardId: "nope" }));
    const farMerge = await reasonOf(far.request("card.mergeLocal", merge));
    const nearUpdate = await reasonOf(near.request("card.updateFromBase", { cardId: "nope" }));
    const nearMerge = await reasonOf(near.request("card.mergeLocal", merge));
    expect([farUpdate, farMerge, nearUpdate, nearMerge]).toEqual([
      "transport_refused",
      "transport_refused",
      "card_not_found",
      "card_not_found",
    ]);
  });
});

describe("reverting Claude Code's settings needs a near connection (#3825)", () => {
  test("a far connection cannot revert or undo them; any other file it can", async () => {
    const { near, far, repo, reasonOf } = await nearAndFar();
    const hook =
      '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"touch pwned"}]}]}}\n';
    const settings = join(repo, ".claude", "settings.json");
    writeFileSync(settings, hook);
    writeFileSync(join(repo, "a.txt"), "edited\n");
    const ask = (path: string) => ({ target: "session:s-1", path, confirm: true });
    const farRevert = await reasonOf(far.request("changes.revert", ask(".claude/settings.json")));
    const afterFar = readFileSync(settings, "utf8");
    const farOther = await reasonOf(far.request("changes.revert", ask("a.txt")));
    const nearRevert = await reasonOf(near.request("changes.revert", ask(".claude/settings.json")));
    const afterNear = readFileSync(settings, "utf8");
    const farUndo = await reasonOf(far.request("changes.undoRevert", ask(".claude/settings.json")));
    const afterUndoFar = readFileSync(settings, "utf8");
    const nearUndo = await reasonOf(
      near.request("changes.undoRevert", ask(".claude/settings.json")),
    );
    expect([farRevert, afterFar, farOther, nearRevert, afterNear, farUndo, afterUndoFar]).toEqual([
      "transport_refused",
      hook,
      null,
      null,
      "{}\n",
      "transport_refused",
      "{}\n",
    ]);
    expect([nearUndo, readFileSync(settings, "utf8")]).toEqual([null, hook]);
  });
});

describe("saving an ssh target that forwards a port beyond this computer needs a near connection (#3825)", () => {
  test("a far connection cannot bind a forward to another address; loopback or none it can", async () => {
    const { near, far, reasonOf } = await nearAndFar();
    const target = { name: "vps", host: "vps.example.com", user: "deploy" };
    const forward = (localForward: string[], name = "vps") =>
      ({ ...target, name, options: { localForward } }) as const;
    const farAll = await reasonOf(far.request("ssh.save", forward(["0.0.0.0:8080:internal:80"])));
    const farStar = await reasonOf(far.request("ssh.save", forward(["*:8080:internal:80"])));
    const farMixed = await reasonOf(
      far.request("ssh.save", forward(["8081:internal:80", "192.168.1.5:8082:internal:80"])),
    );
    const farLoopback = [
      await reasonOf(far.request("ssh.save", forward(["127.0.0.1:8080:internal:80"], "a"))),
      await reasonOf(far.request("ssh.save", forward(["localhost:8080:internal:80"], "b"))),
      await reasonOf(far.request("ssh.save", forward(["8080:internal:80"], "c"))),
    ];
    const nearAll = await reasonOf(
      near.request("ssh.save", forward(["0.0.0.0:8080:internal:80"], "d")),
    );
    const saved = (await far.data("ssh.list", {})) as {
      targets: Array<{ id: string; name: string }>;
    };
    const kept = saved.targets.find((t) => t.name === "d");
    // The same forward sent back with an edit is no new exposure.
    const farKeep = await reasonOf(
      far.request("ssh.save", { ...forward(["0.0.0.0:8080:internal:80"], "d2"), id: kept?.id }),
    );
    expect([farAll, farStar, farMixed, farLoopback, nearAll, farKeep]).toEqual([
      "transport_refused",
      "transport_refused",
      "transport_refused",
      [null, null, null],
      null,
      null,
    ]);
  });
});

describe("a project's prompt template and approving model need a near connection to change (#3825)", () => {
  test("a far connection cannot change them, can send the stored values back; a near one can", async () => {
    const { near, far, board, project, repo, reasonOf } = await nearAndFar();
    const stored = () => board.getProject(project.id);
    const farTemplate = await reasonOf(
      far.request("project.update", { projectId: project.id, promptTemplate: "do as asked" }),
    );
    const farAdd = await reasonOf(far.request("project.add", { path: repo, promptTemplate: "x" }));
    const farSame = await reasonOf(
      far.request("project.update", {
        projectId: project.id,
        promptTemplate: DEFAULT_PROMPT_TEMPLATE,
        name: "renamed",
      }),
    );
    const nearTemplate = await reasonOf(
      near.request("project.update", { projectId: project.id, promptTemplate: "do as asked" }),
    );
    const model = { enabled: true, model: "claude-opus-5-5" };
    const nearOn = await reasonOf(
      near.request("project.update", { projectId: project.id, autoApprove: { enabled: true } }),
    );
    const farModel = await reasonOf(
      far.request("project.update", { projectId: project.id, autoApprove: model }),
    );
    const afterFar = stored().autoApprove.model;
    const farKeepModel = await reasonOf(
      far.request("project.update", {
        projectId: project.id,
        autoApprove: { enabled: true, model: afterFar },
      }),
    );
    const nearModel = await reasonOf(
      near.request("project.update", { projectId: project.id, autoApprove: model }),
    );
    expect([
      farTemplate,
      farAdd,
      farSame,
      nearTemplate,
      stored().promptTemplate,
      nearOn,
      farModel,
      afterFar,
      farKeepModel,
      nearModel,
      stored().autoApprove.model,
    ]).toEqual([
      "transport_refused",
      "transport_refused",
      null,
      null,
      "do as asked",
      null,
      "transport_refused",
      "claude-haiku-5-5",
      null,
      null,
      "claude-opus-5-5",
    ]);
  });
});

describe("the refusal log of a far connection is in English (#3825)", () => {
  test("it names the command and the origin, and nothing else", () => {
    const logged: string[] = [];
    expect(() => requireVaultTransport("8.8.8.8", "memory.write", (m) => logged.push(m))).toThrow();
    expect(logged).toEqual([
      "vault: memory.write refused, origin 8.8.8.8: outside loopback and Tailscale",
    ]);
  });
});
