import { describe, expect, test } from "bun:test";
import { createModuleRunner, type DomainModule } from "../../src/server/module.ts";

/** A module that writes down each call the runner makes on it. */
function recorded(name: string, log: string[], phase?: DomainModule["stopPhase"]): DomainModule {
  return {
    start: () => {
      log.push(`${name} start`);
    },
    started: () => {
      log.push(`${name} started`);
    },
    stop: () => {
      log.push(`${name} stop`);
    },
    ...(phase ? { stopPhase: phase } : {}),
  };
}

/**
 * Issue #2094: the order the daemon starts and stops its domains in, as the decision record
 * `docs/decisions/2026-11-12-daemon-domain-modules.md` sets it.
 */
describe("module runner: the daemon domains' start and stop order", () => {
  test("starts each module as it is added, and runs started() in list order after", async () => {
    const log: string[] = [];
    const runner = createModuleRunner();
    await runner.add({ modules: [recorded("a", log), recorded("b", log)] });
    log.push("c built");
    await runner.add({ modules: [recorded("c", log)] });
    log.push("listen");
    await runner.started();
    expect(log).toEqual([
      "a start",
      "b start",
      "c built",
      "c start",
      "listen",
      "a started",
      "b started",
      "c started",
    ]);
  });

  test("a pending start() holds the next module back until it settles", async () => {
    const log: string[] = [];
    const runner = createModuleRunner();
    let release = () => {};
    const slow: DomainModule = {
      start: () =>
        new Promise<void>((resolve) => {
          release = () => {
            log.push("slow settled");
            resolve();
          };
        }),
    };
    const adding = runner.add({ modules: [slow] });
    const next = adding.then(() => log.push("next added"));
    await Promise.resolve();
    log.push("still waiting");
    release();
    await next;
    expect(log).toEqual(["still waiting", "slow settled", "next added"]);
  });

  test("stops first modules in list order, the rest in reverse, then the server, then late ones", async () => {
    const log: string[] = [];
    const runner = createModuleRunner();
    await runner.add({
      modules: [
        recorded("store writer", log, "late"),
        recorded("keep awake", log, "first"),
        recorded("board", log),
      ],
    });
    await runner.add({
      modules: [
        recorded("automations", log),
        recorded("config", log, "first"),
        recorded("teleport", log, "late"),
      ],
    });
    log.length = 0;
    await runner.stop(() => {
      log.push("server stop");
    });
    expect(log).toEqual([
      "keep awake stop",
      "config stop",
      "automations stop",
      "board stop",
      "server stop",
      "teleport stop",
      "store writer stop",
    ]);
  });

  test("an async stop is awaited before the next one begins", async () => {
    const log: string[] = [];
    const runner = createModuleRunner();
    const draining: DomainModule = {
      stop: async () => {
        await Promise.resolve();
        log.push("automations idle");
      },
    };
    await runner.add({ modules: [recorded("board", log), draining] });
    await runner.stop(() => {});
    expect(log).toEqual(["board start", "automations idle", "board stop"]);
  });

  test("the server options are every module's group, merged", async () => {
    const runner = createModuleRunner();
    const quota = {};
    await runner.add({ modules: [{ server: { quota } }, {}] });
    await runner.add({ modules: [{ server: { hostName: "pi" } }] });
    expect(runner.server()).toEqual({ quota, hostName: "pi" });
  });
});
