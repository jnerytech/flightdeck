import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardOptions } from "../../src/board/wiring.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { tempDir } from "../support/helpers.ts";

/**
 * The board as main.ts builds it (issue #1593): a card's spec template is read from a trusted
 * project's checkout only, what goes public is scanned against the vault's values read at each scan,
 * the parallel runs changed from the app reach the config file, and the host's settings reach the
 * board.
 */

const stores: EventStore[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Each passed-through dep, as a value told apart by identity. */
const passed = {
  manager: {},
  preparePersonas: () => {},
  folderLocks: {},
  quota: {},
  budgets: {},
  memory: {},
  pause: {},
  checkLoop: {},
  projectKeys: {},
  cardCost: () => null,
  idle: () => {},
  suspendApproval: () => {},
  log: () => {},
};

function built(prPollIntervalMs = 0) {
  const store = new EventStore(":memory:");
  stores.push(store);
  const dir = tempDir("board-wiring-");
  dirs.push(dir);
  const configFile = join(dir, "config.json");
  writeFileSync(configFile, JSON.stringify({ maxParallelRuns: 2, hostName: "pi" }));
  const vault: string[] = [];
  const options = boardOptions({
    ...(passed as never as Record<keyof typeof passed, never>),
    db: store.db,
    config: { allowedRoots: ["/w"], maxParallelRuns: 3, board: { prPollIntervalMs } },
    configFile,
    trustForKnowledge: async (cwd) =>
      cwd.startsWith("/w/trusted")
        ? { trusted: true, ...(cwd.endsWith("-wt") ? { configRoot: "/w/trusted" } : {}) }
        : { trusted: false, configRoot: "/w/other" },
    vaultValues: () => vault,
  });
  return { options, vault, configFile, db: store.db };
}

describe("board-wiring: the board the daemon builds (#1593)", () => {
  test("a card's spec template comes from a trusted project's checkout only", async () => {
    const { options } = built();
    const root = options.specTemplateRoot;
    expect([
      await root?.("/w/trusted-wt"),
      await root?.("/w/trusted", true),
      await root?.("/w/trusted"),
      await root?.("/w/other", true),
    ]).toEqual(["/w/trusted", "/w/trusted", null, null]);
  });

  test("what goes public is scanned against the vault's values, read at each scan", () => {
    const { options, vault } = built();
    const text = "token zq9-vault-value-81x in the PR";
    const before = options.scanner?.scan(text).length;
    vault.push("zq9-vault-value-81x");
    expect([before, (options.scanner?.scan(text).length ?? 0) > 0]).toEqual([0, true]);
  });

  test("the parallel runs changed from the app are kept in the config file", async () => {
    const { options, configFile } = built();
    await options.onSettingsChange?.({ maxParallelRuns: 5 });
    expect(JSON.parse(readFileSync(configFile, "utf8"))).toEqual({
      maxParallelRuns: 5,
      hostName: "pi",
    });
  });

  test("the host's settings and the database reach the board", () => {
    const { options: off, db } = built();
    const polled = built(9000).options;
    expect([
      off.db === db,
      Object.entries(passed)
        .filter(([key, value]) => off[key as keyof typeof off] !== value)
        .map(([key]) => key),
      off.allowedRoots,
      off.maxParallelRuns,
      "prPollIntervalMs" in off,
      polled.prPollIntervalMs,
    ]).toEqual([true, [], ["/w"], 3, false, 9000]);
  });
});
