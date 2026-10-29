import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Config } from "../src/config.ts";
import { acquireLock } from "../src/lock.ts";
import { runCli } from "../src/main.ts";
import { backupNow, keepLast, listBackups, restoreBackup } from "../src/maintenance/backup.ts";
import { Maintenance } from "../src/maintenance/maintenance.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { MIGRATIONS } from "../src/store/migrations.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-30T12:00:00.000Z");
const POLICY = { eventsDays: 90, externalSessionsDays: 30, usageDays: 400 };
const TOKEN = "backup-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A daemon's database on disk, open (as while the daemon runs), with one session. */
function liveDb() {
  const dataDir = tempDir();
  const store = new EventStore(join(dataDir, "flightdeck.db"));
  cleanups.push(() => store.close());
  store.createSession({
    id: "s1",
    name: "guardada",
    cwd: "/p",
    status: "idle",
    permissionMode: "default",
    model: null,
  });
  return { dataDir, store };
}

/** Files in the backups folder (0 while it does not exist). */
const backupFiles = (dataDir: string) =>
  existsSync(join(dataDir, "backups")) ? readdirSync(join(dataDir, "backups")) : [];

const open = (path: string) => {
  const db = new Database(path, { readonly: true });
  cleanups.push(() => db.close());
  return db;
};

describe("backup", () => {
  test("VACUUM INTO com o banco aberto: arquivo íntegro, mesma user_version, só para o dono", () => {
    const { dataDir, store } = liveDb();
    const info = backupNow(store.db, join(dataDir, "backups"), NOW);
    expect(info.path).toBe(join(dataDir, "backups", "flightdeck-20261030-120000.db"));
    expect(info.at).toBe(new Date(NOW).toISOString());
    expect(info.bytes).toBe(statSync(info.path).size);
    const copy = open(info.path);
    expect(copy.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(copy.query("PRAGMA user_version").get()).toEqual({ user_version: MIGRATIONS.length });
    expect(copy.query("SELECT name FROM sessions").all()).toEqual([{ name: "guardada" }]);
    if (process.platform !== "win32") expect(statSync(info.path).mode & 0o777).toBe(0o600);
    // An explicit destination is used as is (and replaced when it exists).
    const out = join(tempDir(), "manual.db");
    writeFileSync(out, "velho");
    expect(backupNow(store.db, join(dataDir, "backups"), NOW, out).path).toBe(out);
    expect(open(out).query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  test("mantém só os últimos keep", () => {
    const { dataDir, store } = liveDb();
    const dir = join(dataDir, "backups");
    for (let i = 0; i < 9; i++) backupNow(store.db, dir, NOW + i * DAY);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "outro-arquivo.txt"), "fica");
    expect(keepLast(dir, 7)).toHaveLength(2);
    // Newest first: 7 Nov back to 1 Nov; 30 and 31 Oct went.
    expect(listBackups(dir).map((b) => b.path.slice(dir.length + 1))).toEqual(
      [7, 6, 5, 4, 3, 2, 1].map(
        (day) => `flightdeck-202611${String(day).padStart(2, "0")}-120000.db`,
      ),
    );
    expect(existsSync(join(dir, "outro-arquivo.txt"))).toBe(true);
    expect(listBackups(join(dataDir, "nao-existe"))).toEqual([]);
  });

  test("backup diário com o daemon: no boot só se o último tem mais de 24 h; status reúne tudo", () => {
    const { dataDir, store } = liveDb();
    let now = NOW;
    const intervals: Array<() => void> = [];
    const make = () =>
      new Maintenance({
        db: store.db,
        dataDir,
        retention: POLICY,
        backup: { enabled: true, keep: 2 },
        now: () => now,
        timers: {
          setInterval: (fn: () => void) => {
            intervals.push(fn);
            return 1 as unknown as ReturnType<typeof setInterval>;
          },
          clearInterval: () => {},
        },
      });
    const first = make();
    first.start();
    expect(backupFiles(dataDir)).toHaveLength(1);
    // A restart an hour later does not back up again.
    now += 3_600_000;
    make().start();
    expect(backupFiles(dataDir)).toHaveLength(1);
    now += DAY;
    intervals[0]?.();
    now += DAY;
    intervals[0]?.();
    expect(backupFiles(dataDir)).toHaveLength(2);
    const status = first.status();
    expect(status.dbBytes).toBeGreaterThan(0);
    expect(status.backups).toHaveLength(2);
    expect(status.lastBackup?.at).toBe(new Date(now).toISOString());
    expect(status.lastPrune?.dryRun).toBe(false);
    expect(status.counts).toEqual({ sessions: 1, events: 0, externalSessions: 0 });
    const disabled = new Maintenance({
      db: store.db,
      dataDir: tempDir(),
      retention: POLICY,
      backup: { enabled: false, keep: 7 },
      now: () => now,
    });
    disabled.start();
    disabled.stop();
    expect(disabled.status().backups).toEqual([]);
    expect(disabled.status().lastBackup).toBeNull();
  });

  test("restauração: recusa com o daemon rodando, confere integridade e user_version e guarda o .before-restore", () => {
    const { dataDir, store } = liveDb();
    const good = backupNow(store.db, join(dataDir, "backups"), NOW).path;
    store.db.query("UPDATE sessions SET name = 'depois do backup'").run();
    // The daemon is running: its lock is held.
    const lock = acquireLock(dataDir);
    cleanups.push(() => lock?.release());
    const refuse = (file: string) => {
      try {
        restoreBackup({ file, dataDir });
        return "restaurou";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(refuse(good)).toContain("pare o daemon");
    lock?.release();
    store.close();
    const broken = join(tempDir(), "quebrado.db");
    writeFileSync(broken, "isto não é sqlite");
    expect(refuse(broken)).toContain("integridade");
    const future = join(tempDir(), "futuro.db");
    const db = new Database(future);
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    db.close();
    expect(refuse(future)).toContain("mais nova");
    const result = restoreBackup({ file: good, dataDir });
    expect(result.beforeRestore).toBe(join(dataDir, "flightdeck.db.before-restore"));
    const restored = new EventStore(join(dataDir, "flightdeck.db"));
    expect(restored.getSession("s1")?.name).toBe("guardada");
    restored.close();
    const before = open(result.beforeRestore);
    expect(before.query("SELECT name FROM sessions").get()).toEqual({ name: "depois do backup" });
  });

  test("backup na config: ligado, guardando 7", () => {
    expect(Config.parse({}).backup).toEqual({ enabled: true, keep: 7 });
  });

  test("CLI: flightdeckd backup [--out] e flightdeckd restore <arquivo>", async () => {
    const { dataDir, store } = liveDb();
    store.close();
    cleanups.pop();
    const config = join(tempDir(), "config.json");
    writeFileSync(config, JSON.stringify({ token: "t".repeat(32), dataDir }));
    const run = async (args: string[]) => {
      const out: string[] = [];
      let code = null as number | null;
      await runCli(args, {
        env: {},
        log: { log: (m) => out.push(m), error: (m) => out.push(m) },
        exit: (c) => {
          code = c;
        },
        onSignal: () => {},
        now: () => NOW,
      });
      return { code, out: out.join("\n") };
    };
    const auto = await run(["backup", "--config", config]);
    expect(auto.code).toBe(0);
    expect(auto.out).toContain(join(dataDir, "backups", "flightdeck-20261030-120000.db"));
    const out = join(tempDir(), "copia.db");
    expect((await run(["backup", "--out", out, "--config", config])).out).toContain(out);
    const restored = await run(["restore", out, "--config", config]);
    expect(restored.code).toBe(0);
    expect(restored.out).toContain("flightdeck.db.before-restore");
    const missing = await run(["restore", "--config", config]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("restore precisa do arquivo");
  });

  test("protocolo: maintenance.status, maintenance.backup e maintenance.prune, e o recurso maintenance", async () => {
    const { dataDir, store } = liveDb();
    const { manager } = newManager({ store });
    const maintenance = new Maintenance({
      db: store.db,
      dataDir,
      retention: POLICY,
      backup: { enabled: true, keep: 7 },
      now: () => NOW,
    });
    const server = startServer({
      manager,
      maintenance,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect((await client.data<{ features: string[] }>("host.info", {}))?.features).toEqual([
      "maintenance",
    ]);
    const made = await client.data<{ path: string; bytes: number }>("maintenance.backup", {});
    expect(existsSync(made?.path ?? "")).toBe(true);
    expect(await client.data("maintenance.prune", { dryRun: true })).toEqual({
      events: 0,
      permission_requests: 0,
      external_sessions: 0,
      usage_entries: 0,
      quota_samples: 0,
    });
    const status = await client.data<{ backups: unknown[]; lastPrune: { dryRun: boolean } }>(
      "maintenance.status",
      {},
    );
    expect(status?.backups).toHaveLength(1);
    expect(status?.lastPrune.dryRun).toBe(true);
  });
});
