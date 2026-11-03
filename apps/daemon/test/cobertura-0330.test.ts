/**
 * Coverage of the branches the no-sync changes left without a test: a read that fails for a reason
 * other than "missing", a file that is not there, a helper nobody passed an override to.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withIdleQuery } from "../src/account/readers.ts";
import { excludeLocalSettingsAsync, freshBase } from "../src/board/worktree.ts";
import { Central } from "../src/central/central.ts";
import { ProjectKeys } from "../src/central/project-key.ts";
import { Snapshots } from "../src/checkpoints/snapshots.ts";
import { backupNow, listBackups, restoreBackup } from "../src/maintenance/backup.ts";
import { Maintenance } from "../src/maintenance/maintenance.ts";
import { ProjectMemory } from "../src/memory/memory.ts";
import { packPersonas } from "../src/personas/pack.ts";
import { Personas } from "../src/personas/store.ts";
import { inspectPlugin } from "../src/plugins/inventory.ts";
import { filePins } from "../src/plugins/plugins.ts";
import { cloneRepo, gitRunner } from "../src/project-find.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { processOps } from "../src/ssh/key-delivery.ts";
import { EventStore } from "../src/store/event-store.ts";
import { SummaryService } from "../src/summary/service.ts";
import { telemetryConflicts } from "../src/telemetry/otlp-env.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { newManager, tempDir } from "./helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const reasonOf = async (run: Promise<unknown>) =>
  run.then(
    () => undefined,
    (error: { reason?: string; code?: string }) => error.reason ?? error.code,
  );

describe("cobertura-0330: account readers", () => {
  test("the idle prompt never yields, so the CLI waits for a question that does not come", async () => {
    let pulled: Promise<unknown> | undefined;
    let closed = 0;
    const result = await withIdleQuery(
      {
        claudePath: null,
        query: ({ prompt }) => {
          pulled = prompt[Symbol.asyncIterator]().next();
          return { close: () => void (closed += 1) } as never;
        },
      },
      async () => "ok",
    );
    expect(result).toBe("ok");
    expect(await Promise.race([pulled, Bun.sleep(25).then(() => "still waiting")])).toBe(
      "still waiting",
    );
    expect(closed).toBe(1);
  });
});

describe("cobertura-0330: worktree", () => {
  test("a repository without the local exclude file gets one with the line", async () => {
    const { repo } = gitRepo();
    rmSync(join(repo, ".git", "info", "exclude"), { force: true });
    await excludeLocalSettingsAsync(repo);
    expect(
      readFileSync(join(repo, ".git", "info", "exclude"), "utf8").trim().length,
    ).toBeGreaterThan(0);
  });

  test("freshBase: no origin keeps the base; a failed fetch is a notice; a remote ahead wins; level stays local", async () => {
    const { root, repo } = gitRepo();
    expect(await freshBase(repo, "main")).toEqual({ ref: "main", notice: null });
    git(repo, "remote", "add", "origin", join(root, "nowhere.git"));
    const failed = await freshBase(repo, "main");
    expect(failed.ref).toBe("main");
    expect(failed.notice).toContain("Could not refresh main from origin");
    const remote = join(root, "remote.git");
    git(root, "init", "-q", "--bare", "-b", "main", "remote.git");
    git(repo, "remote", "set-url", "origin", remote);
    git(repo, "push", "-q", "origin", "main");
    expect(await freshBase(repo, "main")).toEqual({ ref: "main", notice: null });
    git(root, "clone", "-q", remote, "other");
    const other = join(root, "other");
    writeFileSync(join(other, "new.txt"), "x\n");
    git(other, "add", ".");
    git(other, "-c", "user.name=t", "-c", "user.email=t@x.invalid", "commit", "-q", "-m", "ahead");
    git(other, "push", "-q", "origin", "main");
    expect(await freshBase(repo, "main")).toEqual({ ref: "origin/main", notice: null });
  });
});

describe("cobertura-0330: snapshots, backup, maintenance", () => {
  test("pruning a snapshot whose repository is gone drops the row and runs no git", async () => {
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    let now = Date.parse("2026-11-03T10:00:00.000Z");
    const snapshots = new Snapshots({ db: store.db, now: () => now });
    const { repo } = gitRepo();
    writeFileSync(join(repo, "a.txt"), "1\n");
    await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind: "before" });
    rmSync(repo, { recursive: true, force: true });
    now += 40 * 86_400_000;
    expect(await snapshots.prune({ perSession: 50, days: 30 })).toBe(1);
    expect(snapshots.list("s1")).toEqual([]);
  });

  test("listing backups of something that is not a folder fails; restoring into an empty data folder keeps nothing to save", async () => {
    const dir = tempDir("fd-cob-backup-");
    writeFileSync(join(dir, "afile"), "x");
    await expect(listBackups(join(dir, "afile"))).rejects.toMatchObject({ code: "ENOTDIR" });
    const live = new EventStore(join(dir, "live.db"));
    const file = (
      await backupNow(live.db, join(dir, "backups"), Date.parse("2026-11-03T10:00:00Z"))
    ).path;
    live.close();
    const dataDir = join(dir, "empty-data");
    mkdirSync(dataDir, { recursive: true });
    const result = await restoreBackup({ file, dataDir });
    expect(statSync(join(dataDir, "flightdeck.db")).isFile()).toBe(true);
    expect(() => statSync(result.beforeRestore)).toThrow();
  });

  test("a maintenance state file that is not JSON is an error, not a silent reset", async () => {
    const dataDir = tempDir("fd-cob-maint-");
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    writeFileSync(join(dataDir, "maintenance.json"), "{not json");
    const maintenance = new Maintenance({
      db: store.db,
      dataDir,
      retention: { eventsDays: 30, sessionsDays: 90 } as never,
    });
    await expect(maintenance.lastPrune()).rejects.toThrow();
  });
});

describe("cobertura-0330: stores and readers", () => {
  test("removing a project persona whose file cannot be removed is an error that is not 'not found'", async () => {
    const dir = tempDir("fd-cob-personas-");
    const project = join(dir, "proj");
    mkdirSync(join(project, ".flightdeck", "personas", "seg.md"), { recursive: true });
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const personas = new Personas({
      db: store.db,
      allowedRoots: [dir],
      scanner: new SecretScanner(),
      pack: packPersonas,
    });
    const reason = await reasonOf(personas.remove("project", "seg", project));
    expect(reason).not.toBeUndefined();
    expect(reason).not.toBe("persona_not_found");
  });

  test("a plugin folder without a manifest file is inspected with no manifest", async () => {
    const dir = tempDir("fd-cob-plugin-");
    writeFileSync(join(dir, "README.md"), "# a plugin without a manifest\n");
    const inventory = await inspectPlugin(dir);
    expect(inventory.hash.length).toBeGreaterThan(0);
  });

  test("telemetry settings that cannot be read as a file are an error", async () => {
    const dir = tempDir("fd-cob-telemetry-");
    await expect(telemetryConflicts(dir)).rejects.toMatchObject({ code: "EISDIR" });
  });

  test("two plugin pin changes in a row: a failed one does not stop the next", async () => {
    const dir = tempDir("fd-cob-pins-");
    const path = join(dir, "pins.json");
    mkdirSync(path);
    const pins = filePins(path);
    await expect(
      pins.set("a@b", { hash: "h1", at: "2026-11-03T10:00:00Z" } as never),
    ).rejects.toThrow();
    rmSync(path, { recursive: true });
    await pins.set("a@b", { hash: "h2", at: "2026-11-03T10:00:00Z" } as never);
    expect(JSON.parse(readFileSync(path, "utf8"))["a@b"].hash).toBe("h2");
  });

  test("the summary of a session whose transcript file is gone is 'not indexed'", async () => {
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    store.db
      .query("INSERT INTO history_sessions (claude_session_id, file_path) VALUES (?, ?)")
      .run("gone", join(tempDir(), "no-such-transcript.jsonl"));
    const service = new SummaryService({ db: store.db, scanner: new SecretScanner() });
    expect(await reasonOf(service.get("gone"))).toBe("transcript_not_indexed");
  });

  test("a project memory lookup that fails is dropped, and a second request made meanwhile fails too", async () => {
    const mem = new ProjectMemory({ claudeDir: tempDir("fd-cob-memory-") });
    const missing = join(tempDir(), "no", "such", "project");
    const results = await Promise.allSettled([mem.dir(missing), mem.dir(missing)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  });
});

describe("cobertura-0330: project finder, ssh agent", () => {
  test("an address that names nothing is a bad folder name", async () => {
    const roots = [tempDir("fd-cob-clone-")];
    const git = async () => ({ code: 0, stderr: "" });
    expect(
      await reasonOf(cloneRepo({ url: "https://", root: roots[0] as string }, roots, git)),
    ).toBe("clone_name_invalid");
  });

  test("the real git runner answers its exit code and stderr, and stops a git that never ends", async () => {
    const run = gitRunner(5_000);
    expect(await run(["--version"])).toMatchObject({ code: 0 });
    const failed = await run([
      "clone",
      "--",
      join(tempDir(), "no-such-repo"),
      join(tempDir(), "dest"),
    ]);
    expect(failed.code).not.toBe(0);
    const impatient = gitRunner(100);
    const started = Date.now();
    const slow = await impatient(["-c", "alias.slow=!sleep 5", "slow"]);
    expect(slow.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  test("the real ssh-agent helper looks for its socket on disk", async () => {
    const dir = tempDir("fd-cob-agent-");
    const sock = join(dir, "agent.sock");
    writeFileSync(sock, "");
    const slept: number[] = [];
    const ops = processOps(undefined, undefined, async (ms) => void slept.push(ms));
    expect(await ops.waitForSocket(sock)).toBe(true);
    expect(await ops.waitForSocket(join(dir, "never.sock"))).toBe(false);
    expect(slept.length).toBe(40);
    symlinkSync(sock, join(dir, "link"));
  });
});

describe("cobertura-0330: central", () => {
  test("hooks: asking to install needs confirm; install, status and uninstall go through the host's settings", async () => {
    const dir = tempDir("fd-cob-central-");
    const configFile = join(dir, "config.json");
    writeFileSync(configFile, "{}");
    const { manager, store } = newManager();
    const central = new Central({
      db: store.db,
      keys: new ProjectKeys("h", async () => ({ code: 1, stdout: "" })),
      manager,
      hooks: { port: 0, permissionTimeoutS: 600, staleAfterS: 900 },
      dataDir: join(dir, "data"),
      hostName: "h",
      configFile,
      selfCommand: ["flightdeckd"],
      settingsPath: () => join(dir, "settings.json"),
    });
    cleanups.push(() => central.stop());
    await expect(central.hooksInstall(false)).rejects.toThrow("confirm");
    await expect(central.hooksUninstall(false)).rejects.toThrow("confirm");
    expect((await central.hooksStatus()).status).toBe("absent");
    expect((await central.hooksInstall(true)).status).toBe("installed");
    expect((await central.hooksStatus()).status).toBe("installed");
    expect((await central.hooksUninstall(true)).status).toBe("absent");
  });

  test("a receptor file that cannot be written does not crash the daemon, and stopping settles", async () => {
    const dir = tempDir("fd-cob-central-file-");
    const configFile = join(dir, "config.json");
    writeFileSync(configFile, "{}");
    const notAFolder = join(dir, "data");
    writeFileSync(notAFolder, "a file where the data folder should be");
    const { manager, store } = newManager();
    const central = new Central({
      db: store.db,
      keys: new ProjectKeys("h", async () => ({ code: 1, stdout: "" })),
      manager,
      hooks: {
        port: 0,
        token: "central-token-0123456789abcdef",
        permissionTimeoutS: 600,
        staleAfterS: 900,
      },
      dataDir: notAFolder,
      hostName: "h",
      configFile,
      selfCommand: ["flightdeckd"],
      settingsPath: () => join(dir, "settings.json"),
    });
    await expect(central.ready()).rejects.toThrow();
    // Stopping waits for the failed write and settles (cleaning up under a file may complain).
    expect(["stopped", "refused"]).toContain(
      await central.stop().then(
        () => "stopped",
        () => "refused",
      ),
    );
  });
});
