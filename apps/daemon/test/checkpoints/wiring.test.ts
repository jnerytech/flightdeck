import { afterEach, describe, expect, test } from "bun:test";
import { dirname } from "node:path";
import { Snapshots } from "../../src/checkpoints/snapshots.ts";
import { createCheckpoints } from "../../src/checkpoints/wiring.ts";
import { withoutPersonas } from "../../src/personas/prepare.ts";
import { FakeRuntime } from "../../src/runtime/fake-runtime.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { gitRepo } from "../support/board-helpers.ts";
import { newManager } from "../support/helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("checkpoints-wiring: the checkpoints the daemon serves (#2094)", () => {
  test("its module serves the snapshots, a rewind over them and a fork that rewinds first and reads the personas", async () => {
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const runtime = new FakeRuntime({ delayMs: 1 });
    const { repo } = gitRepo();
    const { manager } = newManager({ store, runtime, allowedRoots: [dirname(repo)] });
    cleanups.push(() => manager.shutdown());
    const snapshots = new Snapshots({ db: store.db });
    const prepared: string[] = [];
    const {
      modules: [module],
    } = createCheckpoints({
      snapshots,
      manager,
      runtime,
      prepare: (persona, cwd) => {
        prepared.push(cwd);
        return withoutPersonas(persona, cwd);
      },
    });
    const group = module.server?.checkpoints;
    const reason = (e: { reason?: string }) => e.reason;
    const preview = await group?.rewinder?.preview("orig-1", 1).then(() => "previewed", reason);
    const rewound = await group?.forker
      ?.fork({ claudeSessionId: "orig-1", cwd: repo, open: "terminal", rewindTurn: 1 })
      .then(() => "forked", reason);
    const opened = await group?.forker?.fork({
      claudeSessionId: "orig-1",
      cwd: repo,
      open: "flightdeck",
    });
    expect([
      group?.snapshots === snapshots,
      preview,
      rewound,
      manager.list().map((session) => `${session.id} ${session.claudeSessionId}`),
      prepared,
    ]).toEqual([
      true,
      "snapshot_missing",
      "snapshot_missing",
      [`${opened?.sessionId} ${opened?.claudeSessionId}`],
      [repo],
    ]);
  });
});
