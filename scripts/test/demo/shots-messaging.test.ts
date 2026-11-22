import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { agentShots } from "../../lib/shots/table-agent.ts";

const IDS = { idleSession: "idle" } as DemoIds;
const NAMES = [
  "conversas",
  "sessao-mensagens",
  "sessao-mensagens-recusa",
  "configuracoes-mensagens-pausa",
];
const shots = () => agentShots(IDS).filter((shot) => NAMES.includes(shot.name));
const named = (name: string) => shots().find((shot) => shot.name === name);

// #4088: the Conversations page, a session's Messages tab with a refused send, and a paused pair
// with an exception in Settings had no print, so no axe check and no review of their states.
describe("the messaging prints (#4088)", () => {
  test("the table prints the Conversations page, the Messages tab with and without a refused send, and the paused pair in Settings", () => {
    expect(shots().map((shot) => shot.name)).toEqual(NAMES);
  });

  test("the Conversations page opens as its own route, and the Messages tab on the session the demo gives messages to", () => {
    expect(named("conversas")?.route).toEqual({ name: "conversations" });
    for (const name of ["sessao-mensagens", "sessao-mensagens-recusa"]) {
      const route = named(name)?.route;
      expect(route?.name === "session" ? route.id : null).toBe("idle");
    }
    expect(named("configuracoes-mensagens-pausa")?.route).toEqual({ name: "settings" });
  });

  test("the refused-send print answers the send with a refusal that carries its reason key, and the other one sends nothing", () => {
    expect(named("sessao-mensagens-recusa")?.wire).toEqual([
      {
        command: "messages.send",
        data: {
          id: expect.any(String),
          status: "refused",
          reason: expect.stringContaining("limit"),
          reasonKey: "messaging_limit_pair",
          reasonParams: { limit: expect.any(Number) },
        },
      },
    ]);
    expect(named("sessao-mensagens")?.wire).toBeUndefined();
  });

  test("the refused-send print opens the Messages tab, then the form, writes a text and sends it, in that order", async () => {
    const calls: string[] = [];
    const text = (arg: unknown): string => {
      if (arg instanceof RegExp || typeof arg === "string") return String(arg);
      if (typeof arg === "object" && arg !== null) return Object.values(arg).map(text).join(",");
      return typeof arg;
    };
    const member = (name: string): unknown =>
      new Proxy(
        (...args: unknown[]) => {
          calls.push(`${name}(${args.map(text).join(",")})`);
          return recorder;
        },
        { get: (_target, prop) => (recorder as Record<string | symbol, unknown>)[prop] },
      );
    const recorder: unknown = new Proxy(() => recorder, {
      // `then` stays undefined, or awaiting the recorder would wait for it forever.
      get: (_target, prop) => (prop === "then" ? undefined : member(String(prop))),
    });
    await named("sessao-mensagens-recusa")?.prepare?.(recorder as never);
    const at = (needle: string) => calls.findIndex((call) => call.includes(needle));
    const tab = at("Mensagens");
    const write = at("Mandar para outra sess");
    const field = calls.findIndex((call) => call.startsWith("fill("));
    const send = at("Enviar");
    expect(tab).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(tab);
    expect(field).toBeGreaterThan(write);
    expect(send).toBeGreaterThan(field);
  });
});
