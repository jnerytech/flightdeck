import { describe, expect, test } from "bun:test";
import type { SendResult } from "@flightdeck/protocol";
import { MAX_TEXT_BYTES } from "../../src/messaging/domain/policy.ts";
import { PROJECT, setup, twoHosts } from "../support/messaging-helpers.ts";

const OTHER = "github.com/acme/outro";

/** The key and values a refusal carries for the app to translate. */
const why = (result: { reasonKey?: string | null; reasonParams?: unknown }) => ({
  key: result.reasonKey ?? null,
  params: result.reasonParams ?? null,
});

function rig() {
  const ctx = setup();
  ctx.endpoints.add("s1");
  ctx.endpoints.add("s2");
  ctx.endpoints.add("far", { projectKey: OTHER });
  return ctx;
}

// #4083: a refused message carries a reason key and its values, so the app writes it in its language.
describe("a refused message carries a reason key (#4083)", () => {
  test("a pair with no route, a text that is empty or too big and a session that is not there", () => {
    const { messaging } = rig();
    const as = { session: "s1" };
    expect(why(messaging.send({ as, to: "far", text: "oi" }))).toEqual({
      key: "messaging_no_route",
      params: null,
    });
    expect(why(messaging.send({ as, to: "s2", text: "  " })).key).toBe("messaging_text_empty");
    expect(why(messaging.send({ as, to: "s2", text: "a".repeat(MAX_TEXT_BYTES + 1) }))).toEqual({
      key: "messaging_text_too_big",
      params: null,
    });
    expect(why(messaging.send({ as, to: "s1", text: "oi" })).key).toBe("messaging_self");
    expect(why(messaging.send({ as, to: "ghost", text: "oi" }))).toEqual({
      key: "messaging_target_not_found",
      params: { address: "ghost" },
    });
  });

  test("a session that cannot receive says why, by key", () => {
    const { messaging, endpoints } = rig();
    endpoints.add("gone", { controllable: false, reason: "the session has ended" });
    endpoints.infos.get("gone")!.reasonKey = "messaging_session_ended";
    expect(why(messaging.send({ as: { session: "s1" }, to: "gone", text: "oi" })).key).toBe(
      "messaging_session_ended",
    );
  });

  test("a loop pauses the pair: the message that trips it and the next one carry their keys and limits", () => {
    const { messaging, now } = rig();
    messaging.setPolicy({ loopMessages: 4, loopMinutes: 5 });
    const results: SendResult[] = [];
    for (let i = 0; i < 12 && !results.some((r) => r.status === "refused"); i++) {
      now.at += 1000;
      results.push(
        messaging.send({
          as: { session: i % 2 ? "s2" : "s1" },
          to: i % 2 ? "s1" : "s2",
          text: `m${i}`,
        }),
      );
    }
    const loop = results.at(-1) as SendResult;
    expect(why(loop)).toEqual({ key: "messaging_limit_loop", params: { messages: 4, minutes: 5 } });
    expect(why(messaging.send({ as: { session: "s1" }, to: "s2", text: "mais" })).key).toBe(
      "messaging_pair_paused",
    );
  });

  test("the hourly limits carry their number", () => {
    const { messaging } = rig();
    messaging.setPolicy({ perPairPerHour: 1, perSessionPerHour: 50 });
    const as = { session: "s1" };
    expect(messaging.send({ as, to: "s2", text: "um" }).status).toBe("delivered");
    expect(why(messaging.send({ as, to: "s2", text: "dois" }))).toEqual({
      key: "messaging_limit_pair",
      params: { limit: 1 },
    });
  });

  test("the stored message lists the same key and values; a delivered one carries none", () => {
    const { messaging } = rig();
    const as = { session: "s1" };
    messaging.send({ as, to: "s2", text: "ok" });
    messaging.send({ as, to: "far", text: "oi" });
    const listed = messaging.list({});
    const refused = listed.find((m) => m.status === "refused");
    const delivered = listed.find((m) => m.status === "delivered");
    expect(why(refused ?? {})).toEqual({ key: "messaging_no_route", params: null });
    expect(why(delivered ?? {})).toEqual({ key: null, params: null });
    expect(PROJECT).not.toBe(OTHER);
  });

  test("a restart expires what waited in memory, with its key", () => {
    const first = rig();
    first.endpoints.add("busy");
    first.endpoints.busy.add("busy");
    first.messaging.send({ as: { session: "s1" }, to: "busy", text: "espere" });
    const again = setup({ db: first.store.db });
    const expired = again.messaging.list({}).find((m) => m.status === "expired");
    expect(why(expired ?? {}).key).toBe("messaging_restarted");
  });

  test("a key a remote host sends is kept only inside the messaging namespace, with plain values", () => {
    const { a } = twoHosts();
    a.endpoints.add("s1");
    a.messaging.setPeers("wsl", [
      {
        id: "w1",
        name: "w1",
        persona: null,
        projectKey: PROJECT,
        teamId: null,
        state: "idle",
        kind: "managed",
        receives: true,
        reason: null,
      },
    ]);
    const sent = (text: string) => a.messaging.send({ as: { session: "s1" }, to: "wsl/w1", text });
    const keyOf = (id: string) => why(a.messaging.list({}).find((m) => m.id === id) ?? {});
    const forged = sent("um");
    a.messaging.relayed(forged.id, {
      status: "refused",
      reason: "refused over there",
      reasonKey: "constructor",
      reasonParams: { limit: 3 },
    });
    expect(keyOf(forged.id)).toEqual({ key: null, params: null });
    const real = sent("dois");
    a.messaging.relayed(real.id, {
      status: "refused",
      reason: "refused over there",
      reasonKey: "messaging_limit_session",
      reasonParams: { limit: 3 },
    });
    expect(keyOf(real.id)).toEqual({ key: "messaging_limit_session", params: { limit: 3 } });
  });
});
