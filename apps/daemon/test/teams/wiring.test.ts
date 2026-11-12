import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Central } from "../../src/central/central.ts";
import { ProjectKeys } from "../../src/central/project-key.ts";
import { Names } from "../../src/names/names.ts";
import { packPersonas } from "../../src/personas/pack.ts";
import { withoutPersonas } from "../../src/personas/prepare.ts";
import { Personas } from "../../src/personas/store.ts";
import { SecretScanner } from "../../src/snippets/model.ts";
import { createTeams } from "../../src/teams/wiring.ts";
import { newBoard } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("teams-wiring: the sessions that work together, as the daemon builds them (#2094)", () => {
  test("its module serves the messages, the idle notices, the teams and the personas, and its stop lets go of the quota", async () => {
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
      prepare: withoutPersonas,
      quota,
    });
    const messaging = module.server?.messaging;
    const personas = module.server?.personas;
    await module.start?.();
    const started = [...watching];
    await module.stop?.();
    expect([
      messaging?.messages !== undefined,
      messaging?.idle?.pending(),
      messaging?.teams !== undefined,
      personas?.store === personaStore,
      personas?.sessions !== undefined,
      started,
      watching,
    ]).toEqual([true, 0, true, true, true, ["on"], ["on", "off"]]);
  });
});
