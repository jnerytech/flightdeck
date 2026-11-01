import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Central } from "../src/central/central.ts";
import { ExternalSessions } from "../src/central/external.ts";
import { ProjectKeys } from "../src/central/project-key.ts";
import { startReceptor } from "../src/central/receptor.ts";
import { Names } from "../src/names/names.ts";
import { type TrackOptions, trackNames, warmKnown } from "../src/names/track.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newBoard } from "./board-helpers.ts";
import { newManager, poll, tempDir } from "./helpers.ts";

const HOOKS = "hooks-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Real manager and board over one store; the tracker starts when asked. */
function rig(over: Partial<TrackOptions> = {}) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const external = new ExternalSessions({ db: ctx.store.db, staleAfterS: 900 });
  const names = new Names(ctx.store.db);
  const options: TrackOptions = {
    names,
    manager: ctx.manager,
    external,
    projectOf: (cwd) => ctx.board.projectForCwd(cwd)?.project.path ?? cwd,
    cardOf: () => null,
    ...over,
  };
  const start = () => cleanups.push(trackNames(options));
  const create = () => ctx.manager.create({ cwd: ctx.repo, prompt: "oi" }).sessionId;
  return { ...ctx, external, names, options, start, create };
}

const display = (names: Names, id: string) => names.get(id)?.display ?? null;

describe("chave-quente: the project key is looked up before the places that read it need it", () => {
  test("a managed session is named when its folder has been looked up, not before", async () => {
    const gate = Promise.withResolvers<void>();
    const asked: string[] = [];
    const { names, manager, start, create } = rig({
      warm: async (cwd) => {
        asked.push(cwd);
        await gate.promise;
      },
    });
    start();
    const id = create();
    await Bun.sleep(20);
    // Asked again by each summary event of the session; the keys answer them from one lookup.
    expect([...new Set(asked)]).toEqual([manager.get(id).cwd]);
    expect(display(names, id)).toBeNull();
    gate.resolve();
    expect(await poll(() => display(names, id))).toBe("repo · geral · 1");
  });

  test("a session whose folder is already known is named on the spot, so the code that reads its name right after creating it finds it", () => {
    const { names, start, create } = rig({ warm: () => undefined });
    start();
    expect(display(names, create())).toBe("repo · geral · 1");
  });

  test("sessions created while the lookup is pending are named in the order they were created", async () => {
    const gate = Promise.withResolvers<void>();
    const { names, start, create } = rig({ warm: () => gate.promise });
    start();
    const first = create();
    const second = create();
    await Bun.sleep(20);
    expect([display(names, first), display(names, second)]).toEqual([null, null]);
    gate.resolve();
    expect(await poll(() => display(names, second))).toBe("repo · geral · 2");
    expect(display(names, first)).toBe("repo · geral · 1");
  });

  test("a lookup that fails does not leave the session without a name", async () => {
    let asked = 0;
    const { names, start, create } = rig({
      warm: () => {
        asked++;
        return Promise.reject(new Error("no git"));
      },
    });
    start();
    const id = create();
    expect(await poll(() => display(names, id))).toBe("repo · geral · 1");
    expect(asked).toBe(1);
  });

  test("the sessions already here, managed and from terminals, are looked up before naming starts", async () => {
    const gate = Promise.withResolvers<void>();
    const asked: string[] = [];
    const { manager, external, create, options } = rig();
    const id = create();
    external.apply("SessionStart", { session_id: "t1", cwd: "/work/loja" });
    external.apply("SessionStart", { session_id: "t2" });
    const warm = async (cwd: string) => {
      asked.push(cwd);
      await gate.promise;
    };
    const done = warmKnown({ ...options, warm });
    expect(await Promise.race([done, Promise.resolve("held")])).toBe("held");
    expect([...asked].sort()).toEqual([manager.get(id).cwd, "/work/loja"].sort());
    gate.resolve();
    await done;
  });

  test("a hook is applied once its folder has been looked up, and a hook without folder at once", async () => {
    const gate = Promise.withResolvers<void>();
    const asked: string[] = [];
    const store = new EventStore(":memory:");
    const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
    const receptor = startReceptor({
      port: 0,
      token: () => HOOKS,
      external,
      isManaged: (id) => id === "mine",
      warm: async (cwd) => {
        asked.push(cwd);
        await gate.promise;
      },
    });
    cleanups.push(() => receptor.stop());
    const post = (event: string, body: unknown) =>
      fetch(`${receptor.url}/hooks/${event}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${HOOKS}` },
        body: JSON.stringify(body),
      });
    expect((await post("Stop", { session_id: "bare" })).status).toBe(200);
    expect(external.get("bare")).not.toBeNull();
    await post("SessionStart", { session_id: "mine", cwd: "/w/mine" });
    expect(asked).toEqual([]);
    const held = post("SessionStart", { session_id: "s1", cwd: "/w/one" });
    expect(await poll(() => asked.length > 0)).toBe(true);
    await Bun.sleep(20);
    expect(external.get("s1")).toBeNull();
    gate.resolve();
    expect((await held).status).toBe(200);
    expect(asked).toEqual(["/w/one"]);
    expect(external.get("s1")).not.toBeNull();
  });

  test("the hub shares the host's keys: a hook is stored with the key looked up before it", async () => {
    const dir = tempDir();
    const configFile = join(dir, "config.json");
    writeFileSync(configFile, "{}");
    const { manager, store } = newManager();
    const calls: string[][] = [];
    const keys = new ProjectKeys(
      "h",
      () => ({ code: 1, stdout: "" }),
      async (args) => {
        calls.push(args);
        if (args.includes("--git-common-dir")) return { code: 0, stdout: "/w/one/.git\n" };
        return { code: 0, stdout: "git@github.com:Acme/Repo.git\n" };
      },
    );
    const central = new Central({
      db: store.db,
      keys,
      manager,
      hooks: { port: 0, token: HOOKS, permissionTimeoutS: 600, staleAfterS: 900 },
      dataDir: join(dir, "data"),
      hostName: "h",
      configFile,
      selfCommand: ["flightdeckd"],
      settingsPath: () => join(dir, "settings.json"),
    });
    cleanups.push(() => central.stop());
    const response = await fetch(`${central.receptorUrl()}/hooks/SessionStart`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${HOOKS}` },
      body: JSON.stringify({ session_id: "s1", cwd: "/w/one" }),
    });
    expect(response.status).toBe(200);
    expect(central.external.get("s1")?.projectKey).toBe("github.com/acme/repo");
    expect(central.projectKey("/w/one")).toBe("github.com/acme/repo");
    expect(calls).toHaveLength(2);
  });
});
