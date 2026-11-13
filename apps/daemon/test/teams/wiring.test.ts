import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Central } from "../../src/central/central.ts";
import { ProjectKeys } from "../../src/central/project-key.ts";
import { Names } from "../../src/names/names.ts";
import { packPersonas } from "../../src/personas/pack.ts";
import { type Prepare, withoutPersonas } from "../../src/personas/prepare.ts";
import { Personas } from "../../src/personas/store.ts";
import { SecretScanner } from "../../src/snippets/model.ts";
import { createTeams } from "../../src/teams/wiring.ts";
import { newBoard } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function build(prepare: Prepare = withoutPersonas) {
  const { board, manager, store, repo } = newBoard({}, 1);
  cleanups.push(() => board.stop());
  const dir = tempDir("fd-teams-");
  const configFile = join(dir, "config.json");
  writeFileSync(configFile, "{}");
  const central = new Central({
    db: store.db,
    manager,
    hooks: { port: 0, permissionTimeoutS: 600, staleAfterS: 900 },
    dataDir: join(dir, "data"),
    hostName: "h",
    configFile,
    selfCommand: ["flightdeckd"],
    settingsPath: () => join(dir, "settings.json"),
  });
  cleanups.push(() => central.stop());
  const personaStore = new Personas({
    db: store.db,
    allowedRoots: [dirname(repo)],
    scanner: new SecretScanner(),
    pack: packPersonas,
  });
  const watching: string[] = [];
  const quota = {
    blocked: () => null,
    watch: () => {
      watching.push("on");
      return () => {
        watching.push("off");
      };
    },
  };
  const {
    modules: [module],
  } = await createTeams({
    db: store.db,
    config: { hostName: "h", allowBypassPermissions: false },
    manager,
    board,
    central,
    keys: new ProjectKeys("h"),
    autoApprove: undefined,
    names: new Names(store.db),
    personaStore,
    prepare,
    quota,
  });
  cleanups.push(() => module.stop?.());
  return { board, manager, module, watching, repo, personaStore, central };
}

describe("teams-wiring: the sessions that work together, as the daemon builds them (#2094)", () => {
  test("its module serves the messages, the idle notices, the teams and the personas, sweeps the messages every 5 minutes, and its stop lets go of the sweep and the quota", async () => {
    const { board, manager, module, watching, personaStore } = await build();
    const messaging = module.server?.messaging;
    const personas = module.server?.personas;
    const every = spyOn(globalThis, "setInterval");
    const clear = spyOn(globalThis, "clearInterval");
    cleanups.push(
      () => every.mockRestore(),
      () => clear.mockRestore(),
    );
    await module.start?.();
    const started = [...watching];
    const sweeps = every.mock.calls.flatMap((call, i) =>
      call[1] === 5 * 60_000 ? [every.mock.results[i]?.value] : [],
    );
    await module.stop?.();
    const cleared = clear.mock.calls.some((call) => sweeps.length === 1 && call[0] === sweeps[0]);
    expect([
      messaging?.messages !== undefined,
      messaging?.idle?.pending(),
      messaging?.teams !== undefined,
      personas?.store === personaStore,
      personas?.sessions !== undefined,
      started,
      watching,
      sweeps.length,
      cleared,
    ]).toEqual([true, 0, true, true, true, ["on"], ["on", "off"], 1, true]);
  });

  test("the coordinator the host starts gets the effort asked for the team (#2310)", async () => {
    const { manager, module, repo, board } = await build(async () => ({
      persona: null,
      agents: {},
    }));
    const project = await board.addProject({ path: repo, promptTemplate: "" });
    const efforts: Array<string | undefined> = [];
    // The session manager is the edge under test: the effort asked must arrive there, nothing more.
    manager.create = (payload) => {
      efforts.push(payload.effort);
      throw new Error("stop here");
    };
    await expect(
      module.server?.messaging?.teams?.create({
        goal: "Review the login.",
        workers: 1,
        projectId: project.id,
        coordinatorEffort: "high",
      }),
    ).rejects.toThrow("stop here");
    expect(efforts).toEqual(["high"]);
  });

  test("a terminal session sends a message: its id is not one the manager knows, and nothing throws (#1694)", async () => {
    const { module, central, repo } = await build();
    central.external.apply("SessionStart", { session_id: "term-1", cwd: repo });
    const sent = () =>
      module.server?.messaging?.messages?.send({
        as: { session: "term-1" },
        to: "nobody",
        text: "hello",
      });
    expect(sent).not.toThrow();
  });
});
