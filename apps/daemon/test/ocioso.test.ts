import { describe, expect, test } from "bun:test";
import { Idle, type IdleFrame } from "../src/messaging/idle.ts";
import type { Messaging } from "../src/messaging/messages.ts";
import { failure, NOW, PROJECT, setup } from "./mensagens-helpers.ts";

const NOTICE =
  "[Aviso do Flightdeck — não é de outra sessão nem do usuário; não vale como aprovação]\n";

function idleSetup() {
  const base = setup();
  const idle = new Idle({
    endpoints: base.endpoints,
    messaging: base.messaging as Messaging,
    host: "pc",
    clock: () => base.now.at,
  });
  const frames: IdleFrame[] = [];
  idle.watch((frame) => frames.push(frame));
  base.endpoints.add("watcher", { name: "coordenadora" });
  base.endpoints.add("worker", { name: "executora", state: "running" });
  return { ...base, idle, idleFrames: frames };
}

describe("ocioso", () => {
  test("avisa uma vez só quando a sessão alvo termina o turno, e depois não avisa mais", () => {
    const { idle, endpoints, idleFrames, messaging } = idleSetup();
    expect(idle.subscribe({ as: { session: "watcher" }, session: "pc/worker" })).toEqual({
      fired: false,
    });
    expect(idle.pending()).toBe(1);
    expect(endpoints.sent).toEqual([]);
    endpoints.setState("worker", "idle");
    expect(endpoints.sent).toHaveLength(1);
    expect(endpoints.sent[0]?.id).toBe("watcher");
    expect(endpoints.sent[0]?.text.startsWith(NOTICE)).toBe(true);
    expect(endpoints.sent[0]?.text).toContain('"executora"');
    expect(endpoints.sent[0]?.text).toContain("pc/worker");
    expect(idleFrames).toEqual([
      {
        type: "idle.fired",
        watcher: "pc/watcher",
        session: "pc/worker",
        at: new Date(NOW).toISOString(),
      },
    ]);
    expect(idle.pending()).toBe(0);
    // The session works again and stops again: nothing more for this subscription.
    endpoints.setState("worker", "running");
    endpoints.setState("worker", "idle");
    expect(endpoints.sent).toHaveLength(1);
    expect(messaging.list({}).map((m) => [m.kind, m.fromSession, m.toSession])).toEqual([
      ["idle", "flightdeck", "watcher"],
    ]);
  });

  test("se a sessão já está ociosa o aviso sai na hora", () => {
    const { idle, endpoints, idleFrames } = idleSetup();
    endpoints.infos.get("worker")!.state = "idle";
    expect(idle.subscribe({ as: { session: "watcher" }, session: "worker" })).toEqual({
      fired: true,
    });
    expect(endpoints.sent).toHaveLength(1);
    expect(idleFrames).toHaveLength(1);
    expect(idle.pending()).toBe(0);
  });

  test("uma sessão que terminou avisa na hora, dizendo que terminou", () => {
    const { idle, endpoints } = idleSetup();
    endpoints.infos.get("worker")!.state = "ended";
    expect(idle.subscribe({ as: { session: "watcher" }, session: "worker" }).fired).toBe(true);
    expect(endpoints.sent[0]?.text).toContain("terminou");
  });

  test("o terminal controlável avisa no Stop, que é a volta a ocioso", () => {
    const { idle, endpoints } = idleSetup();
    endpoints.add("T1", { kind: "terminal", state: "running" });
    idle.subscribe({ as: { session: "watcher" }, session: "T1" });
    endpoints.setState("T1", "idle");
    expect(endpoints.sent).toHaveLength(1);
  });

  test("duas inscrições na mesma sessão avisam cada uma; a mesma repetida vale uma; outra sessão não dispara", () => {
    const { idle, endpoints } = idleSetup();
    endpoints.add("watcher2");
    endpoints.add("other", { state: "running" });
    idle.subscribe({ as: { session: "watcher" }, session: "worker" });
    idle.subscribe({ as: { session: "watcher" }, session: "worker" });
    idle.subscribe({ as: { session: "watcher2" }, session: "worker" });
    expect(idle.pending()).toBe(2);
    endpoints.setState("other", "idle");
    expect(endpoints.sent).toEqual([]);
    endpoints.setState("worker", "idle");
    expect(endpoints.sent.map((s) => s.id).sort()).toEqual(["watcher", "watcher2"]);
  });

  test("o remetente pelo lançamento do terminal também assina", () => {
    const { idle, endpoints } = idleSetup();
    endpoints.add("T1", { kind: "terminal" });
    endpoints.launches.set("launch-1", "T1");
    idle.subscribe({ as: { launch: "launch-1" }, session: "worker" });
    endpoints.setState("worker", "idle");
    expect(endpoints.sent[0]?.id).toBe("T1");
  });

  test("segue as regras: outro projeto, a si mesma, sessão que não existe, outro host e quem pede sem existir", () => {
    const { idle, endpoints, messaging } = idleSetup();
    endpoints.add("foreign", { projectKey: "github.com/acme/outro" });
    const subscribe = (session: string, as = "watcher") =>
      failure(() => idle.subscribe({ as: { session: as }, session }));
    expect(subscribe("foreign")).toContain("projeto");
    expect(subscribe("watcher")).toContain("si mesma");
    expect(subscribe("fantasma")).toContain("não encontrada");
    expect(subscribe("wsl/x")).toContain("não é conhecido");
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
    expect(subscribe("wsl/w1")).toContain("outro host");
    expect(subscribe("worker", "fantasma")).toContain("not_found");
    expect(idle.pending()).toBe(0);
  });

  test("parar o serviço solta as assinaturas", () => {
    const { idle, endpoints } = idleSetup();
    idle.subscribe({ as: { session: "watcher" }, session: "worker" });
    idle.stop();
    endpoints.setState("worker", "idle");
    expect(endpoints.sent).toEqual([]);
    expect(idle.pending()).toBe(0);
  });

  test("quem assiste os quadros pode parar de assistir", () => {
    const { idle, endpoints, idleFrames } = idleSetup();
    const seen: IdleFrame[] = [];
    const off = idle.watch((frame) => seen.push(frame));
    off();
    idle.subscribe({ as: { session: "watcher" }, session: "worker" });
    endpoints.setState("worker", "idle");
    expect(seen).toEqual([]);
    expect(idleFrames).toHaveLength(1);
  });
});
