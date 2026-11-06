import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EventStore } from "../src/store/event-store.ts";
import { MIGRATIONS } from "../src/store/migrations.ts";
import { ProjectTrust } from "../src/trust/project-trust.ts";
import { tempDir, waitFor } from "./helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function fresh(opts: ConstructorParameters<typeof ProjectTrust>[1] = {}) {
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  const lines: string[] = [];
  const trust = new ProjectTrust(store.db, {
    now: () => new Date("2026-11-05T12:00:00.000Z"),
    log: (line) => void lines.push(line),
    ...opts,
  });
  return { store, trust, lines };
}

describe("project-trust: a project's own configuration loads only when the person trusted it (#196)", () => {
  test("nothing is trusted at first; trusting a project trusts its folders and nothing around it", () => {
    const { trust } = fresh();
    expect(trust.isTrusted("/work/app")).toBe(false);
    trust.trust("/work/app");
    expect(trust.isTrusted("/work/app")).toBe(true);
    expect(trust.isTrusted("/work/app/packages/api")).toBe(true);
    expect(trust.isTrusted("/work/other")).toBe(false);
    expect(trust.isTrusted("/work/application")).toBe(false);
    expect(trust.isTrusted("/work")).toBe(false);
  });

  test("a path is compared as written once resolved: a trailing slash or a .. does not change the answer", () => {
    const { trust } = fresh();
    trust.trust("/work/app/");
    expect(trust.isTrusted("/work/app/../app/src")).toBe(true);
    expect(trust.isTrusted("/work/app/../other")).toBe(false);
  });

  test("trusting and revoking are explicit, kept with their time and source, and logged", () => {
    const { trust, lines } = fresh();
    const app = resolve("/work/app");
    const never = resolve("/work/never");
    trust.trust(app);
    trust.trust(app);
    expect(trust.list()).toEqual([
      { path: app, trustedAt: "2026-11-05T12:00:00.000Z", source: "person" },
    ]);
    trust.revoke(app);
    expect(trust.isTrusted(app)).toBe(false);
    expect(trust.list()).toEqual([]);
    expect(lines).toEqual([
      `project trust: trusted ${app} (person)`,
      `project trust: revoked ${app}`,
    ]);
    // Revoking what was never trusted is quiet.
    trust.revoke(never);
    expect(lines).toHaveLength(2);
  });

  test("a worktree reads its configuration from the main checkout, and is trusted only if that is", () => {
    const { trust } = fresh({
      configRootOf: (cwd) => (cwd.startsWith("/work/app-wt/") ? "/work/app" : null),
    });
    expect(trust.sessionTrust("/work/app-wt/card-1")).toEqual({
      trusted: false,
      configRoot: "/work/app",
    });
    trust.trust("/work/app");
    expect(trust.sessionTrust("/work/app-wt/card-1")).toEqual({
      trusted: true,
      configRoot: "/work/app",
    });
    // A folder that is not a worktree has no config root of its own.
    expect(trust.sessionTrust("/work/app")).toEqual({ trusted: true });
    expect(trust.sessionTrust("/elsewhere")).toEqual({ trusted: false });
  });

  test("a worktree inside a trusted folder is still read from the main checkout: its branch never brings its own", () => {
    const { trust } = fresh({ configRootOf: () => "/main/checkout" });
    trust.trust("/work/app");
    expect(trust.sessionTrust("/work/app/wt")).toEqual({
      trusted: false,
      configRoot: "/main/checkout",
    });
  });
});

describe("project-trust: a database from before is migrated so the person's own work does not change", () => {
  test("the projects and the folders of earlier sessions are trusted by the migration; a folder only allowed is not", () => {
    const path = join(tempDir(), "events.db");
    const at = MIGRATIONS.findIndex((sql) => sql.includes("CREATE TABLE project_trust"));
    expect(at).toBeGreaterThan(0);
    const old = new Database(path, { create: true });
    for (const sql of MIGRATIONS.slice(0, at)) old.exec(sql);
    old.exec(`PRAGMA user_version = ${at}`);
    old.exec(
      "INSERT INTO projects (id, path, name, base_branch, pr_provider, prompt_template) VALUES ('p1', '/work/mine', 'mine', 'main', 'github', '')",
    );
    old.exec(
      "INSERT INTO sessions (id, cwd, status, permission_mode, created_at, updated_at) VALUES ('s1', '/work/scratch', 'ended', 'default', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')",
    );
    old.close();
    const store = new EventStore(path);
    cleanups.push(() => store.close());
    const trust = new ProjectTrust(store.db);
    expect(trust.isTrusted("/work/mine")).toBe(true);
    expect(trust.isTrusted("/work/mine/sub")).toBe(true);
    expect(trust.isTrusted("/work/scratch")).toBe(true);
    // The root the person allowed holds repos they have not opened: a new clone there starts untrusted.
    expect(trust.isTrusted("/work/new-clone")).toBe(false);
    expect(
      trust
        .list()
        .map((r) => [r.path, r.source])
        .sort(),
    ).toEqual([
      ["/work/mine", "migration"],
      ["/work/scratch", "migration"],
    ]);
  });
});

describe("project-trust: trust never reaches a folder the person did not mean (security review of #196)", () => {
  test("an allowed root, or a folder that holds one, grants nothing by prefix: a clone inside it starts untrusted", () => {
    const { trust } = fresh({ roots: () => ["/work"] });
    trust.trust("/work");
    trust.trust("/");
    expect(trust.isTrusted("/work/new-clone")).toBe(false);
    expect(trust.isTrusted("/work")).toBe(false);
    trust.trust("/work/app");
    expect(trust.isTrusted("/work/app/src")).toBe(true);
  });

  test("an allowed root given as a symlink still grants nothing by prefix: the record is compared with its real path (review of #196)", async () => {
    const real = tempDir("fd-trust-real-");
    const link = join(tempDir("fd-trust-link-"), "code");
    symlinkSync(real, link);
    const { trust } = fresh({ roots: () => [link] });
    await trust.refreshRoots();
    trust.trust(real);
    expect(trust.isTrusted(join(real, "new-clone"))).toBe(false);
    trust.trust(join(real, "app"));
    expect(trust.isTrusted(join(real, "app", "src"))).toBe(true);
  });

  test("a session folder seeded by the migration is that exact folder and nothing under it; a registered project is its whole tree", () => {
    const path = join(tempDir(), "events.db");
    const at = MIGRATIONS.findIndex((sql) => sql.includes("CREATE TABLE project_trust"));
    const old = new Database(path, { create: true });
    for (const sql of MIGRATIONS.slice(0, at)) old.exec(sql);
    old.exec(`PRAGMA user_version = ${at}`);
    old.exec(
      "INSERT INTO projects (id, path, name, base_branch, pr_provider, prompt_template) VALUES ('p1', '/work/mine', 'mine', 'main', 'github', '')",
    );
    // A session once ran in the root itself, where every later clone lands.
    old.exec(
      "INSERT INTO sessions (id, cwd, status, permission_mode, created_at, updated_at) VALUES ('s1', '/work', 'ended', 'default', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')",
    );
    old.close();
    const store = new EventStore(path);
    cleanups.push(() => store.close());
    const trust = new ProjectTrust(store.db);
    expect(trust.isTrusted("/work")).toBe(true);
    expect(trust.isTrusted("/work/new-clone")).toBe(false);
    expect(trust.isTrusted("/work/mine/packages/api")).toBe(true);
  });

  test("a folder of a card's worktree area is read from the main checkout even when the database does not know it", () => {
    const { trust } = fresh();
    const app = resolve("/work/app");
    expect(trust.sessionTrust(join(app, ".flightdeck", "worktrees", "card-1"))).toEqual({
      trusted: false,
      configRoot: app,
    });
    trust.trust(app);
    expect(trust.sessionTrust(join(app, ".flightdeck", "worktrees", "card-1"))).toEqual({
      trusted: true,
      configRoot: app,
    });
    expect(trust.sessionTrust(join(app, ".claude", "worktrees", "x", "sub"))).toEqual({
      trusted: true,
      configRoot: app,
    });
  });

  test("a nested clone or submodule inside a trusted project is not covered by it; a git worktree is read from its main checkout", async () => {
    const main = tempDir("fd-trust-main-");
    const { trust } = fresh();
    trust.trust(main);
    // A nested clone: its own .git directory.
    const nested = join(main, "vendor", "lib");
    mkdirSync(join(nested, ".git"), { recursive: true });
    // A worktree made by hand inside the repo: .git is a file pointing into the main .git.
    mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
    const wt = join(main, "branches", "wt");
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
    const plain = join(main, "packages", "api");
    mkdirSync(plain, { recursive: true });
    for (const cwd of [nested, wt, plain, join(nested, "src")]) {
      mkdirSync(cwd, { recursive: true });
      await trust.prepare(cwd);
    }
    expect(trust.sessionTrust(nested)).toEqual({ trusted: false });
    expect(trust.sessionTrust(join(nested, "src"))).toEqual({ trusted: false });
    expect(trust.sessionTrust(wt)).toEqual({ trusted: true, configRoot: main });
    expect(trust.sessionTrust(plain)).toEqual({ trusted: true });
    // The nested clone can be trusted on its own, and then it is.
    trust.trust(nested);
    await trust.prepare(nested);
    expect(trust.sessionTrust(nested)).toEqual({ trusted: true });
  });

  test("a worktree area inside a nested clone is read from that clone, which the trusted project around it does not cover (review of #196)", async () => {
    const main = tempDir("fd-trust-main-");
    const { trust } = fresh();
    trust.trust(main);
    const nested = join(main, "vendor", "evil");
    mkdirSync(join(nested, ".git"), { recursive: true });
    const inNested = join(nested, ".claude", "worktrees", "x");
    mkdirSync(inNested, { recursive: true });
    // A forged .git file in the area that points at the trusted checkout changes nothing.
    mkdirSync(join(main, ".git", "worktrees", "z"), { recursive: true });
    writeFileSync(join(inNested, ".git"), `gitdir: ${join(main, ".git", "worktrees", "z")}\n`);
    await trust.prepare(inNested);
    expect(trust.sessionTrust(inNested)).toEqual({ trusted: false, configRoot: nested });
    // An area directly in the trusted project is trusted, as before.
    const direct = join(main, ".claude", "worktrees", "y");
    mkdirSync(direct, { recursive: true });
    await trust.prepare(direct);
    expect(trust.sessionTrust(direct)).toEqual({ trusted: true, configRoot: main });
    // The nested clone trusted on its own makes its own areas trusted.
    trust.trust(nested);
    await trust.prepare(inNested);
    expect(trust.sessionTrust(inNested)).toEqual({ trusted: true, configRoot: nested });
  });

  test("a folder looked at again is never read as trusted while the scan runs (review of #196)", async () => {
    const main = tempDir("fd-trust-main-");
    const { trust } = fresh();
    trust.trust(main);
    const nested = join(main, "vendor", "evil");
    mkdirSync(join(nested, ".git"), { recursive: true });
    await trust.prepare(nested);
    expect(trust.sessionTrust(nested).trusted).toBe(false);
    const again = trust.prepare(nested);
    expect(trust.sessionTrust(nested).trusted).toBe(false);
    await again;
    expect(trust.sessionTrust(nested).trusted).toBe(false);
  });

  test("an area whose main checkout is itself a worktree is read from the checkout that was judged (review of #196)", async () => {
    const root = tempDir("fd-trust-main-");
    const { trust } = fresh();
    trust.trust(root);
    mkdirSync(join(root, ".git", "worktrees", "w"), { recursive: true });
    const checkout = join(root, "sub");
    mkdirSync(checkout, { recursive: true });
    writeFileSync(join(checkout, ".git"), `gitdir: ${join(root, ".git", "worktrees", "w")}\n`);
    const area = join(checkout, ".claude", "worktrees", "x");
    mkdirSync(area, { recursive: true });
    await trust.prepare(area);
    expect(trust.sessionTrust(area)).toEqual({ trusted: true, configRoot: root });
  });

  test("the folders of the sessions open before a restart are read once each, at boot", async () => {
    const main = tempDir("fd-trust-main-");
    const { trust } = fresh();
    trust.trust(main);
    const nested = join(main, "vendor", "evil");
    mkdirSync(join(nested, ".git"), { recursive: true });
    const plain = join(main, "app");
    mkdirSync(plain, { recursive: true });
    await trust.prepareSessions([{ cwd: plain }, { cwd: nested }, { cwd: plain }]);
    expect(trust.sessionTrust(nested).trusted).toBe(false);
    expect(trust.sessionTrust(plain).trusted).toBe(true);
  });

  test("a .git file that cannot be read closes the folder: it is its own boundary and not trusted", async () => {
    const main = tempDir("fd-trust-");
    const odd = join(main, "odd");
    mkdirSync(odd, { recursive: true });
    writeFileSync(join(odd, ".git"), "gitdir: ../.git/worktrees/odd\n");
    const { trust } = fresh({
      readText: async () => {
        throw new Error("EACCES");
      },
    });
    trust.trust(main);
    await trust.prepare(odd);
    expect(trust.sessionTrust(odd)).toEqual({ trusted: false });
  });
});

describe("project-trust: two looks at one folder at once end with the later one (issue #415)", () => {
  test("a scan that finishes last does not overwrite what a scan started after it found", async () => {
    const main = tempDir("fd-trust-");
    const odd = join(main, "odd");
    mkdirSync(odd, { recursive: true });
    writeFileSync(join(odd, ".git"), "gitdir: unused\n");
    const answers: Array<(text: string) => void> = [];
    const { trust } = fresh({
      readText: () => new Promise<string>((resolveText) => answers.push(resolveText)),
    });
    trust.trust(main);
    const first = trust.prepare(odd);
    await waitFor(() => answers.length === 1, { label: "first scan reads" });
    const second = trust.prepare(odd);
    await waitFor(() => answers.length === 2, { label: "second scan reads" });
    answers[1]?.(`gitdir: ${join(main, "two", ".git", "worktrees", "odd")}`);
    await second;
    answers[0]?.(`gitdir: ${join(main, "one", ".git", "worktrees", "odd")}`);
    await first;
    expect(trust.sessionTrust(odd).configRoot).toBe(join(main, "two"));
  });
});
