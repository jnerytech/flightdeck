import { describe, expect, test } from "bun:test";
import {
  AppUpdateSlice,
  type AppUpdateState,
  initialAppUpdateState,
} from "../src/features/appupdate/index.ts";
import type { AppUpdate } from "../src/platform/types.ts";

const OFFER: AppUpdate = { version: "9.9.0", notes: "" };

/**
 * A slice over a fake updater: every call it gets is written down in `calls`, `found` is what
 * `check` finds, and `fail` names the calls that reject.
 */
function appUpdate(
  over: {
    found?: AppUpdate | null;
    supported?: boolean;
    notify?: boolean;
    auto?: boolean;
    fail?: Array<"check" | "download" | "install" | "installDownloaded">;
  } = {},
) {
  let state: AppUpdateState = initialAppUpdateState();
  const calls: string[] = [];
  const logs: string[] = [];
  const step = (name: "check" | "download" | "install" | "installDownloaded") => {
    calls.push(name);
    if (over.fail?.includes(name)) throw new Error(`${name} refused`);
  };
  const slice = new AppUpdateSlice({
    updater: () => ({
      supported: over.supported ?? true,
      check: async () => {
        step("check");
        return over.found === undefined ? OFFER : over.found;
      },
      download: async () => step("download"),
      installDownloaded: async () => step("installDownloaded"),
      install: async () => step("install"),
    }),
    state: () => state,
    setState: (next) => {
      state = next;
    },
    switches: () => ({ notifyUpdates: over.notify ?? true, autoUpdate: over.auto ?? false }),
    intervalMs: () => 600_000,
    log: (level, source, message) => void logs.push(`${level} ${source}: ${message}`),
    quitNow: async () => void calls.push("quitNow"),
    t: () => ((key: string, params?: { error: string }) => `${key}: ${params?.error}`) as never,
  });
  return { slice, state: () => state, calls, logs };
}

describe("app update slice", () => {
  test("a check that finds a version offers it, and says so in the log", async () => {
    const w = appUpdate();
    await w.slice.check();
    expect(w.state()).toEqual({ offer: OFFER, upToDate: false, error: null, ready: null });
    expect(w.logs).toEqual(["info update: version 9.9.0 is available"]);
  });

  test("a check that finds nothing says the app is up to date", async () => {
    const w = appUpdate({ found: null });
    await w.slice.check();
    expect(w.state()).toEqual({ offer: null, upToDate: true, error: null, ready: null });
    expect(w.logs).toEqual(["info update: up to date"]);
  });

  test("a check that fails says why, in the state and in the log, and offers nothing", async () => {
    const w = appUpdate({ fail: ["check"] });
    await w.slice.check();
    expect(w.state().error).toBe("messages.updateCheckFailed: check refused");
    expect(w.state().offer).toBeNull();
    expect(w.logs).toEqual(["error update: the check failed: check refused"]);
  });

  test("by itself, a version is downloaded once, and the same one again is not downloaded twice", async () => {
    const w = appUpdate({ auto: true });
    await w.slice.check();
    await w.slice.check();
    expect(w.calls).toEqual(["check", "download", "check"]);
    expect(w.state().ready).toBe("9.9.0");
  });

  test("without the switch, a version on offer is not downloaded", async () => {
    const w = appUpdate({ auto: false });
    await w.slice.check();
    expect(w.calls).toEqual(["check"]);
  });

  test("a download that fails says why and offers nothing to restart into", async () => {
    const w = appUpdate({ auto: true, fail: ["download"] });
    await w.slice.check();
    expect(w.state().ready).toBeNull();
    expect(w.state().error).toBe("messages.updateDownloadFailed: download refused");
  });

  test("an install that fails installs nothing and says why; one that works sets no error", async () => {
    const bad = appUpdate({ fail: ["install"] });
    await bad.slice.install();
    expect(bad.state().error).toBe("messages.updateInstallFailed: install refused");
    const good = appUpdate();
    await good.slice.install();
    expect([good.calls, good.state().error]).toEqual([["install"], null]);
  });

  test("dismissing hides the offer and leaves the rest", async () => {
    const w = appUpdate({ auto: true });
    await w.slice.check();
    w.slice.dismiss();
    expect(w.state()).toEqual({ offer: null, upToDate: false, error: null, ready: "9.9.0" });
  });

  test("quitting installs a version downloaded in the background, then exits", async () => {
    const w = appUpdate({ auto: true });
    await w.slice.check();
    w.calls.length = 0;
    await w.slice.quit();
    expect(w.calls).toEqual(["installDownloaded", "quitNow"]);
  });

  test("quitting with nothing downloaded just exits, and an install that fails does not stop it", async () => {
    const none = appUpdate();
    await none.slice.quit();
    expect(none.calls).toEqual(["quitNow"]);
    const bad = appUpdate({ auto: true, fail: ["installDownloaded"] });
    await bad.slice.check();
    bad.calls.length = 0;
    await bad.slice.quit();
    expect(bad.calls).toEqual(["installDownloaded", "quitNow"]);
  });

  test("a second Quit while the first runs is ignored", async () => {
    const w = appUpdate({ auto: true });
    await w.slice.check();
    w.calls.length = 0;
    await Promise.all([w.slice.quit(), w.slice.quit()]);
    expect(w.calls).toEqual(["installDownloaded", "quitNow"]);
  });

  test("start checks at once only where the updater works and a switch asks for it", async () => {
    const run = async (over: Parameters<typeof appUpdate>[0]) => {
      const w = appUpdate(over);
      w.slice.start();
      w.slice.dispose();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      return w.calls;
    };
    expect(await run({})).toEqual(["check"]);
    expect(await run({ supported: false })).toEqual([]);
    expect(await run({ notify: false, auto: false })).toEqual([]);
    // Only the automatic switch downloads what the check finds.
    expect(await run({ notify: false, auto: true })).toEqual(["check", "download"]);
  });
});
