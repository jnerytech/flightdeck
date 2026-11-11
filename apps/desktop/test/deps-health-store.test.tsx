import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { DepsResult, DoctorResult } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import {
  daemonRefusal,
  daemon as makeDaemon,
  memoryPlatform,
  waitFor as pollFor,
  TOKEN,
} from "./fixtures.ts";

registerDom();
const { act, cleanup } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const RESULT: DepsResult = {
  items: [{ id: "claude", group: "required", state: "ok", breaks: [], fix: [] }],
};

/** A host whose `deps.check` and `doctor.run` answer, refuse or wait as the test says. */
async function connected(
  answers: { deps?: () => DepsResult; doctor?: () => Promise<DoctorResult> } = {},
) {
  let depsAsked = 0;
  const d = makeDaemon(cleanups, {
    firstRun: true,
    deps: () => {
      depsAsked += 1;
      return (answers.deps ?? (() => RESULT))();
    },
    ...(answers.doctor ? { doctor: answers.doctor } : {}),
  });
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  await act(async () => {
    await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  });
  const hostId = await pollFor(() => store.getState().hosts[0]?.id, "the host");
  await pollFor(() => store.getState().healthAt[hostId] || undefined, "the first read");
  return { store, hostId, depsAsked: () => depsAsked, doctorAsked: () => d.doctorAsked.length };
}

describe("deps-health-store: the background health read is silent and independent (HD-M3, HD-M4)", () => {
  test("a refusal gives no banner and no Retry, and the half that answered is kept", async () => {
    let doctorDown = false;
    const { store, hostId } = await connected({
      doctor: async () => {
        if (doctorDown) throw daemonRefusal("doctor is down");
        return { ok: true, checks: [] };
      },
    });
    expect(store.getState().healthError[hostId]).toBeUndefined();
    const notices = store.getState().notices.length;
    doctorDown = true;
    await store.health.check(hostId);
    expect(store.getState().notices).toHaveLength(notices);
    expect(store.getState().deps[hostId]).toEqual(RESULT);
    expect(store.getState().healthError[hostId]).toContain("doctor is down");
  });

  test("when both halves fail the error is kept for the screen, and a good read clears it", async () => {
    let busy = false;
    const { store, hostId } = await connected({
      deps: () => {
        if (busy) throw daemonRefusal("host busy");
        return RESULT;
      },
      doctor: async () => {
        if (busy) throw daemonRefusal("host busy");
        return { ok: true, checks: [] };
      },
    });
    busy = true;
    await store.health.check(hostId);
    expect(store.getState().healthError[hostId]).toContain("host busy");
    busy = false;
    await store.health.check(hostId);
    expect(store.getState().healthError[hostId]).toBeUndefined();
  });

  test("two reads at the same time send one pair of commands and share the answer", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    const { store, hostId, depsAsked, doctorAsked } = await connected({
      doctor: async () => {
        // The first read's doctor.run waits here until the test has started the second read.
        if (held) await gate;
        return { ok: true, checks: [] };
      },
    });
    // Joins any read still in flight from the connection, so the counts below are this test's own.
    await store.health.check(hostId);
    const [depsBefore, doctorBefore] = [depsAsked(), doctorAsked()];
    held = true;
    const first = store.health.check(hostId);
    await pollFor(() => (doctorAsked() > doctorBefore ? true : undefined), "the doctor asked");
    const second = store.health.check(hostId);
    release();
    await Promise.all([first, second]);
    expect([depsAsked() - depsBefore, doctorAsked() - doctorBefore]).toEqual([1, 1]);
    held = false;
    await store.health.check(hostId);
    expect([depsAsked() - depsBefore, doctorAsked() - doctorBefore]).toEqual([2, 2]);
  });
});
