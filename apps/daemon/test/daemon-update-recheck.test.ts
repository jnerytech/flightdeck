import { afterEach, describe, expect, test } from "bun:test";
import { startServer } from "../src/server.ts";
import { UpdateChecker } from "../src/updates/check.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { manualTime } from "./time-helpers.ts";

const TOKEN = "update-recheck-token-0123456789";
const HOUR = 3_600_000;

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const manifest = (version: string) => ({
  version,
  protocol: 1,
  assets: {
    "linux-x64": { url: "http://127.0.0.1/x", sha256: "a".repeat(64), signature: "s" },
  },
});

/** A local release server whose manifest the test can change. */
function releaseServer(initial: unknown) {
  const state = { body: JSON.stringify(initial), status: 200, hits: 0 };
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      state.hits++;
      return new Response(state.body, { status: state.status });
    },
  });
  cleanups.push(() => server.stop(true));
  return { url: `http://127.0.0.1:${server.port}/daemon-latest.json`, state };
}

function checker(url: string) {
  const time = manualTime(Date.parse("2026-11-03T10:00:00.000Z"));
  const updates = new UpdateChecker({
    manifestUrl: url,
    checkIntervalH: 6,
    currentVersion: "0.8.0",
    now: time.now,
    timers: time.timers,
  });
  cleanups.push(() => updates.stop());
  return { updates, time };
}

describe("atualizacao-rechecar: the daemon checks for an update when asked", () => {
  test("checkNow downloads the manifest at once, returns what it found and keeps it as the status", async () => {
    const release = releaseServer(manifest("0.8.0"));
    const { updates, time } = checker(release.url);
    await updates.start();
    expect(updates.status()).toMatchObject({ available: false, version: "0.8.0" });
    release.state.body = JSON.stringify(manifest("0.9.0"));
    time.advance(HOUR);
    const found = await updates.checkNow();
    expect(release.state.hits).toBe(2);
    expect(found).toEqual({
      available: true,
      version: "0.9.0",
      checkedAt: "2026-11-03T11:00:00.000Z",
    });
    expect(updates.status()).toEqual(found);
    expect(updates.latest()?.version).toBe("0.9.0");
  });

  test("a failed check says why in the result and the interval timer is not doubled", async () => {
    const release = releaseServer(manifest("0.9.0"));
    const { updates, time } = checker(release.url);
    await updates.start();
    release.state.status = 503;
    const failed = await updates.checkNow();
    expect(failed).toMatchObject({ available: false, version: null });
    expect(failed.error).toBe("o servidor respondeu HTTP 503");
    // Two checks ran, so one timer waits: the next check comes one interval after the last.
    expect(time.pending.filter((timer) => !timer.cleared)).toHaveLength(1);
    release.state.status = 200;
    time.advance(6 * HOUR);
    await Bun.sleep(20);
    expect(release.state.hits).toBe(3);
  });

  test("daemon.update.check answers the status over the protocol; a daemon that does not check refuses with its reason", async () => {
    const release = releaseServer(manifest("0.8.0"));
    const { updates } = checker(release.url);
    await updates.start();
    release.state.body = JSON.stringify(manifest("0.9.1"));
    const { manager } = newManager();
    const base = { manager, hostName: "h", bind: "127.0.0.1", port: 0, token: TOKEN };
    const server = startServer({ ...base, allowedRoots: [], updates });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.data<unknown>("daemon.update.check", {})).toMatchObject({
      available: true,
      version: "0.9.1",
    });
    expect((await client.data<{ update?: unknown }>("host.info", {}))?.update).toMatchObject({
      version: "0.9.1",
    });

    const plain = startServer({ ...base, allowedRoots: [] });
    cleanups.push(() => plain.stop());
    const other = new FrameClient(plain.url);
    cleanups.push(() => other.close());
    await other.request("hello", { token: TOKEN, client: "t" });
    const refused = await other.request("daemon.update.check", {});
    expect(refused).toMatchObject({ ok: false, error: { reason: "feature_off" } });
  });
});
