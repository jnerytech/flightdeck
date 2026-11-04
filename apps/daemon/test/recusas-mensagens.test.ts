import { afterEach, describe, expect, test } from "bun:test";
import { ExternalSessions } from "../src/central/external.ts";
import { FlightdeckError } from "../src/errors.ts";
import { LocalEndpoints } from "../src/messaging/endpoints.ts";
import { Idle } from "../src/messaging/idle.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager } from "./helpers.ts";
import { PROJECT, setup } from "./mensagens-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The code, reason and params of the refusal a call ends in. */
async function refused(call: () => unknown) {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(FlightdeckError);
    const { code, reason, params } = error as FlightdeckError;
    return { code, reason, params };
  }
  throw new Error("it did not refuse");
}

describe("recusas-mensagens: the real adapter", () => {
  test("a session that is not there, a terminal with no channel, one whose channel is down", async () => {
    const { manager, project } = newManager({ runtime: new FakeRuntime({ delayMs: 20 }) });
    const external = new ExternalSessions({
      db: new EventStore(":memory:").db,
      staleAfterS: 3600,
      projectKey: () => PROJECT,
    });
    const endpoints = new LocalEndpoints({
      manager,
      external,
      nameOf: () => null,
      projectKey: () => PROJECT,
      cardOf: () => null,
      sendToLaunch: () => false,
    });
    cleanups.push(() => endpoints.stop());
    expect(await refused(() => endpoints.send("nope", "hi"))).toEqual({
      code: "not_found",
      reason: "messaging_session_missing",
      params: { id: "nope" },
    });
    external.apply("SessionStart", { session_id: "T1", cwd: project });
    expect((await refused(() => endpoints.send("T1", "hi"))).reason).toBe(
      "messaging_plain_session",
    );
    external.apply("SessionStart", { session_id: "T2", cwd: project, launch_id: "L2" });
    external.setChannel("L2", true);
    expect(await refused(() => endpoints.send("T2", "hi"))).toEqual({
      code: "invalid_state",
      reason: "messaging_channel_down",
      params: undefined,
    });
  });
});

describe("recusas-mensagens: addressing", () => {
  const me = { session: "a" };
  const rig = () => {
    const ctx = setup();
    cleanups.push(() => ctx.messaging.stop());
    ctx.endpoints.add("a");
    ctx.endpoints.add("b");
    ctx.endpoints.add("other", { projectKey: "github.com/acme/other" });
    return ctx;
  };

  test("an asker that is not known, an address that is not found, a host that is not known", async () => {
    const { messaging } = rig();
    expect(await refused(() => messaging.sessions({ session: "ghost" }))).toEqual({
      code: "not_found",
      reason: "messaging_asker_unknown",
      params: undefined,
    });
    expect(await refused(() => messaging.read(me, "pc/nope"))).toEqual({
      code: "not_found",
      reason: "messaging_target_not_found",
      params: { address: "pc/nope" },
    });
    expect(await refused(() => messaging.read(me, "zzz/x"))).toEqual({
      code: "not_found",
      reason: "messaging_host_unknown",
      params: { host: "zzz" },
    });
    messaging.setPeers("wsl", []);
    expect(await refused(() => messaging.read(me, "wsl/x"))).toEqual({
      code: "not_found",
      reason: "messaging_peer_not_found",
      params: { address: "wsl/x", host: "wsl" },
    });
  });

  test("a session messaging itself, a pair no rule connects, a session of another host", async () => {
    const { messaging } = rig();
    expect((await refused(() => messaging.read(me, "pc/a"))).reason).toBe("messaging_self");
    expect(await refused(() => messaging.read(me, "pc/other"))).toEqual({
      code: "invalid_state",
      reason: "messaging_no_route",
      params: undefined,
    });
    messaging.setPeers("wsl", [
      {
        id: "w1",
        name: null,
        persona: null,
        projectKey: PROJECT,
        teamId: null,
        state: "idle",
        kind: "managed",
        receives: true,
        reason: null,
      },
    ]);
    expect(await refused(() => messaging.read(me, "wsl/w1"))).toEqual({
      code: "invalid_state",
      reason: "messaging_read_other_host",
      params: undefined,
    });
  });

  test("a transcript that cannot be read, and a policy that does not validate", async () => {
    const { messaging, endpoints } = rig();
    endpoints.read = async () => null;
    expect((await refused(() => messaging.read(me, "pc/b"))).reason).toBe(
      "messaging_target_not_found",
    );
    const bad = await refused(() => messaging.setPolicy({ perPairPerHour: "many" }));
    expect(bad.code).toBe("bad_request");
    expect(bad.reason).toBe("messaging_policy_invalid");
    expect(typeof bad.params?.errors).toBe("string");
  });

  test("a notice for when a session idles only covers sessions of this host", async () => {
    const { messaging, endpoints } = rig();
    const idle = new Idle({ endpoints, messaging, host: "pc", clock: () => 0 });
    cleanups.push(() => idle.stop());
    messaging.setPeers("wsl", [
      {
        id: "w1",
        name: null,
        persona: null,
        projectKey: PROJECT,
        teamId: null,
        state: "running",
        kind: "managed",
        receives: true,
        reason: null,
      },
    ]);
    expect(await refused(() => idle.subscribe({ as: me, session: "wsl/w1" }))).toEqual({
      code: "invalid_state",
      reason: "messaging_idle_other_host",
      params: { address: "wsl/w1" },
    });
  });
});
