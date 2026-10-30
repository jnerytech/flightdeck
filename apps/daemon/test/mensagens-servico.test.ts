import { describe, expect, test } from "bun:test";
import { UNTRUSTED_MARK } from "../src/messaging/header.ts";
import type { MessagingFrame, PeerSession } from "../src/messaging/messages.ts";
import { HOUR, MINUTE, NOW, PROJECT, setup, twoHosts } from "./mensagens-helpers.ts";

const OTHER = "github.com/acme/outro";
const peer = (over: Partial<PeerSession> = {}): PeerSession => ({
  id: "w1",
  name: "w1",
  persona: null,
  projectKey: PROJECT,
  teamId: null,
  state: "idle",
  kind: "managed",
  receives: true,
  reason: null,
  ...over,
});

describe("mensagens-regras: o que o serviço aplica", () => {
  test("outro projeto é recusado com o motivo; o mesmo time passa por cima do projeto; uma exceção libera", () => {
    const { messaging, endpoints, teams } = setup();
    endpoints.add("s1");
    endpoints.add("s2", { projectKey: OTHER });
    const refused = messaging.send({ as: { session: "s1" }, to: "s2", text: "oi" });
    expect(refused.status).toBe("refused");
    expect(refused.reason).toContain("projeto");
    expect(endpoints.sent).toEqual([]);

    teams.set("s1", "t1");
    teams.set("s2", "t1");
    expect(messaging.send({ as: { session: "s1" }, to: "s2", text: "oi" }).status).toBe(
      "delivered",
    );

    teams.clear();
    expect(messaging.send({ as: { session: "s1" }, to: "s2", text: "de novo" }).status).toBe(
      "refused",
    );
    messaging.setPolicy({
      exceptions: [{ id: "e1", from: { session: "s1" }, to: { project: OTHER } }],
    });
    expect(messaging.send({ as: { session: "s1" }, to: "s2", text: "agora" }).status).toBe(
      "delivered",
    );
    // The exception is one way: s2 still cannot answer.
    expect(messaging.send({ as: { session: "s2" }, to: "s1", text: "volta" }).status).toBe(
      "refused",
    );
  });

  test("list_sessions esconde quem não pode, quem é a própria sessão e o que não é conhecido", () => {
    const { messaging, endpoints } = setup();
    endpoints.add("s1");
    endpoints.add("s2", { name: "colega", persona: "qa", state: "running" });
    endpoints.add("s3", { projectKey: OTHER });
    endpoints.add("P1", { kind: "plain", controllable: false, reason: "sem canal" });
    messaging.setPeers("wsl", [peer(), peer({ id: "w2", projectKey: OTHER })]);
    const seen = messaging.sessions({ session: "s1" });
    expect(seen.map((s) => s.address).sort()).toEqual(["pc/P1", "pc/s2", "wsl/w1"]);
    expect(seen.find((s) => s.id === "s2")).toMatchObject({
      address: "pc/s2",
      host: "pc",
      name: "colega",
      persona: "qa",
      state: "running",
      projectKey: PROJECT,
      kind: "managed",
      receives: true,
      reason: null,
    });
    expect(seen.find((s) => s.id === "P1")).toMatchObject({ receives: false, reason: "sem canal" });
    expect(() => messaging.sessions({ session: "fantasma" })).toThrow("não existe");
  });

  test("20 por hora por par: a 21ª é recusada com o motivo e a hora seguinte libera", () => {
    const { messaging, endpoints, now } = setup();
    endpoints.add("s1");
    endpoints.add("s2");
    // Alternate directions slowly, so the loop detector stays out of it.
    for (let i = 0; i < 20; i++) {
      now.at = NOW + i * 2 * MINUTE;
      const [from, to] = i % 2 === 0 ? ["s1", "s2"] : ["s2", "s1"];
      expect(
        messaging.send({ as: { session: from as string }, to: to as string, text: `m${i}` }).status,
      ).toBe("delivered");
    }
    const refused = messaging.send({ as: { session: "s1" }, to: "s2", text: "21" });
    expect(refused.status).toBe("refused");
    expect(refused.reason).toContain("20 por hora");
    now.at = NOW + 20 * 2 * MINUTE + HOUR;
    expect(messaging.send({ as: { session: "s1" }, to: "s2", text: "depois" }).status).toBe(
      "delivered",
    );
  });

  test("100 por hora por sessão, e os avisos do Flightdeck não contam", () => {
    const { messaging, endpoints } = setup({}) as ReturnType<typeof setup>;
    endpoints.add("s1");
    // 100 targets, each hit once, so no pair limit is reached.
    for (let i = 0; i < 101; i++) endpoints.add(`t${i}`);
    for (let i = 0; i < 100; i++) {
      expect(messaging.send({ as: { session: "s1" }, to: `t${i}`, text: "oi" }).status).toBe(
        "delivered",
      );
      messaging.notice(`t${i}`, "system", "STOP");
    }
    const refused = messaging.send({ as: { session: "s1" }, to: "t100", text: "oi" });
    expect(refused.status).toBe("refused");
    expect(refused.reason).toContain("100 por hora");
  });

  test("o laço pausa o par, avisa, mantém pausado até a política liberar e vale nos dois sentidos", () => {
    const { messaging, endpoints, frames, now } = setup();
    endpoints.add("s1");
    endpoints.add("s2");
    for (let i = 0; i < 10; i++) {
      now.at = NOW + i * 10_000;
      const [from, to] = i % 2 === 0 ? ["s1", "s2"] : ["s2", "s1"];
      expect(
        messaging.send({ as: { session: from as string }, to: to as string, text: `m${i}` }).status,
      ).toBe("delivered");
    }
    now.at = NOW + 100_000;
    const loop = messaging.send({ as: { session: "s1" }, to: "s2", text: "11" });
    expect(loop.status).toBe("refused");
    expect(loop.reason).toContain("laço");
    expect(messaging.pausedPairs()).toEqual(["pc/s1|pc/s2"]);
    const alert = frames.find((f) => f.type === "messaging.alert") as Extract<
      MessagingFrame,
      { type: "messaging.alert" }
    >;
    expect(alert).toMatchObject({ kind: "loop", from: "pc/s1", to: "pc/s2" });
    expect(alert.message).toContain("pausado");

    // Paused for both directions, even after the ten minutes pass.
    now.at = NOW + 2 * HOUR;
    for (const [from, to] of [
      ["s1", "s2"],
      ["s2", "s1"],
    ] as const) {
      const again = messaging.send({ as: { session: from }, to, text: "ainda" });
      expect(again.status).toBe("refused");
      expect(again.reason).toContain("pausado");
    }
    // The policy frees it.
    const freed = messaging.setPolicy({}, ["pc/s1|pc/s2"]);
    expect(freed.paused).toEqual([]);
    expect(messaging.send({ as: { session: "s1" }, to: "s2", text: "livre" }).status).toBe(
      "delivered",
    );
  });

  test("a mensagem acima de 32 KB é recusada e vazia também", () => {
    const { messaging, endpoints } = setup();
    endpoints.add("s1");
    endpoints.add("s2");
    expect(
      messaging.send({ as: { session: "s1" }, to: "s2", text: "a".repeat(33 * 1024) }),
    ).toMatchObject({
      status: "refused",
      reason: expect.stringContaining("32 KB"),
    });
    expect(messaging.send({ as: { session: "s1" }, to: "s2", text: "  " }).status).toBe("refused");
    expect(endpoints.sent).toEqual([]);
  });

  test("a política é guardada, devolvida, e uma inválida é recusada sem trocar a que valia", () => {
    const { messaging } = setup();
    expect(messaging.getPolicy().perPairPerHour).toBe(20);
    messaging.setPolicy({ perPairPerHour: 5 });
    expect(messaging.getPolicy().perPairPerHour).toBe(5);
    expect(() => messaging.setPolicy({ perPairPerHour: 0 })).toThrow("perPairPerHour");
    expect(messaging.getPolicy().perPairPerHour).toBe(5);
  });

  test("a política e os pares pausados sobrevivem a um novo serviço sobre o mesmo banco", () => {
    const first = setup();
    first.endpoints.add("s1");
    first.endpoints.add("s2");
    first.messaging.setPolicy({ perSessionPerHour: 70 });
    for (let i = 0; i < 10; i++) {
      first.now.at = NOW + i * 10_000;
      const [from, to] = i % 2 === 0 ? ["s1", "s2"] : ["s2", "s1"];
      first.messaging.send({ as: { session: from as string }, to: to as string, text: `m${i}` });
    }
    first.now.at = NOW + 100_000;
    first.messaging.send({ as: { session: "s1" }, to: "s2", text: "laço" });
    const second = setup({ db: first.store.db });
    expect(second.messaging.getPolicy().perSessionPerHour).toBe(70);
    expect(second.messaging.pausedPairs()).toEqual(["pc/s1|pc/s2"]);
  });
});

describe("mensagens-seguranca", () => {
  test("a marca de terceiros vai no texto e a aprovação automática do destino fica suspensa", () => {
    const { messaging, endpoints } = setup();
    endpoints.add("s1");
    endpoints.add("s2");
    endpoints.add("s3");
    endpoints.untrustedIds.add("s1");
    messaging.send({ as: { session: "s1" }, to: "s2", text: "olha isso" });
    expect(endpoints.sent[0]?.text.split("\n")).toContain(UNTRUSTED_MARK);
    expect(endpoints.suspended).toHaveLength(1);
    expect(endpoints.suspended[0]).toMatchObject({ id: "s2" });
    expect(endpoints.suspended[0]?.reason).toContain("terceiros");
    // A trusted sender leaves both alone.
    messaging.send({ as: { session: "s3" }, to: "s2", text: "limpo" });
    expect(endpoints.sent[1]?.text).not.toContain(UNTRUSTED_MARK);
    expect(endpoints.suspended).toHaveLength(1);
  });

  test("a marca atravessa os hosts: o frame leva untrusted e o outro daemon suspende o destino", () => {
    const { a, b } = twoHosts();
    a.endpoints.add("s1");
    a.endpoints.untrustedIds.add("s1");
    b.endpoints.add("w1");
    a.messaging.setPeers("wsl", [peer()]);
    a.messaging.send({ as: { session: "s1" }, to: "wsl/w1", text: "de fora" });
    const relay = a.frames.find((f) => f.type === "messages.relay") as Extract<
      MessagingFrame,
      { type: "messages.relay" }
    >;
    expect(relay.message.untrusted).toBe(true);
    b.messaging.relay(relay.message);
    expect(b.endpoints.sent[0]?.text).toContain(UNTRUSTED_MARK);
    expect(b.endpoints.suspended[0]).toMatchObject({ id: "w1" });
  });

  test("uma mensagem não suspende nada quando é recusada", () => {
    const { messaging, endpoints } = setup();
    endpoints.add("s1");
    endpoints.add("s2", { projectKey: OTHER });
    endpoints.untrustedIds.add("s1");
    messaging.send({ as: { session: "s1" }, to: "s2", text: "oi" });
    expect(endpoints.suspended).toEqual([]);
  });

  test("os avisos do Flightdeck não levam a marca nem suspendem", () => {
    const { messaging, endpoints } = setup();
    endpoints.add("s2");
    endpoints.untrustedIds.add("s2");
    messaging.notice("s2", "idle", "a sessão x terminou");
    expect(endpoints.suspended).toEqual([]);
    expect(endpoints.sent[0]?.text).not.toContain(UNTRUSTED_MARK);
  });
});
