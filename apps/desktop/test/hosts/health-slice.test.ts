import { describe, expect, test } from "bun:test";
import type { DepsResult, DoctorResult } from "@flightdeck/protocol";
import {
  type HealthAnswer,
  type HealthCore,
  HealthSlice,
  initialHealthState,
} from "../../src/features/hosts/index.ts";

const DEPS = { items: [] } as DepsResult;
const DOCTOR = { checks: [] } as unknown as DoctorResult;

/** A slice over a bare state: the host announces `features`, and each half answers as told. */
function slice(
  features: string[] | undefined,
  answers: { deps?: HealthAnswer<DepsResult>; doctor?: HealthAnswer<DoctorResult> } = {},
) {
  let state = initialHealthState();
  let clock = 1000;
  const asked = { deps: 0, doctor: 0 };
  const core: HealthCore = {
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    features: () => features,
    deps: async () => {
      asked.deps += 1;
      return answers.deps ?? { ok: true, data: DEPS };
    },
    doctor: async () => {
      asked.doctor += 1;
      return answers.doctor ?? { ok: true, data: DOCTOR };
    },
    now: () => clock,
  };
  return {
    health: new HealthSlice(core),
    state: () => state,
    asked,
    tick: (ms: number) => {
      clock += ms;
    },
    answer: (next: typeof answers) => Object.assign(answers, next),
  };
}

describe("health slice: a host's dependencies and doctor", () => {
  test("a host that announces neither half is not asked, and nothing is kept", async () => {
    const s = slice([]);
    await s.health.check("h1");
    expect(s.asked).toEqual({ deps: 0, doctor: 0 });
    expect(s.state().healthAt).toEqual({});
  });

  test("a half that failed names its reason while the other half is kept; a good read clears it", async () => {
    const s = slice(["depsCheck", "doctor.run"], { doctor: { ok: false, message: "no doctor" } });
    await s.health.check("h1");
    expect(s.state().deps.h1).toBe(DEPS);
    expect(s.state().doctor.h1).toBeUndefined();
    expect(s.state().healthError.h1).toBe("no doctor");
    s.answer({ doctor: { ok: true, data: DOCTOR } });
    await s.health.check("h1");
    expect(s.state().doctor.h1).toBe(DOCTOR);
    expect(s.state().healthError).toEqual({});
  });

  test("two asks at once share one read", async () => {
    const s = slice(["depsCheck"]);
    await Promise.all([s.health.check("h1"), s.health.check("h1")]);
    expect(s.asked.deps).toBe(1);
  });

  test("ensure reads once, leaves a fresh read alone and reads again past five minutes", async () => {
    const s = slice(["depsCheck"]);
    await s.health.ensure("h1");
    s.tick(60_000);
    await s.health.ensure("h1");
    expect(s.asked.deps).toBe(1);
    s.tick(5 * 60_000);
    await s.health.ensure("h1");
    expect(s.asked.deps).toBe(2);
  });

  test("a removed host leaves no health data, and a re-added host with the same id is read again", async () => {
    const s = slice(["depsCheck", "doctor.run"]);
    await s.health.check("h1");
    await s.health.check("h2");
    s.health.forget("h1");
    expect(Object.keys(s.state().deps)).toEqual(["h2"]);
    expect(Object.keys(s.state().doctor)).toEqual(["h2"]);
    expect(Object.keys(s.state().healthAt)).toEqual(["h2"]);
    await s.health.ensure("h1");
    expect(s.asked.deps).toBe(3);
  });

  test("a read in flight when its host is removed writes nothing back", async () => {
    const s = slice(["depsCheck", "doctor.run"]);
    const reading = s.health.check("h1");
    s.health.forget("h1");
    await reading;
    expect(s.state().deps).toEqual({});
    expect(s.state().doctor).toEqual({});
    expect(s.state().healthAt).toEqual({});
    expect(s.state().healthError).toEqual({});
  });

  test("a host whose reads both fail is not asked again within five minutes", async () => {
    const s = slice(["depsCheck", "doctor.run"], {
      deps: { ok: false, message: "no deps" },
      doctor: { ok: false, message: "no doctor" },
    });
    await s.health.ensure("h1");
    s.tick(60_000);
    await s.health.ensure("h1");
    expect(s.asked).toEqual({ deps: 1, doctor: 1 });
    s.tick(5 * 60_000);
    await s.health.ensure("h1");
    expect(s.asked).toEqual({ deps: 2, doctor: 2 });
  });
});
