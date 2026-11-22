import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { NARROW_SHOTS } from "../../lib/shots/narrow.ts";
import { agentShots } from "../../lib/shots/table-agent.ts";
import { messagingShots } from "../../lib/shots/table-messaging.ts";

const IDS = { idleSession: "idle" } as DemoIds;
const NAMES = ["conversas", "sessao-mensagens", "sessao-mensagens-recusa"];
const shots = () => agentShots(IDS).filter((shot) => NAMES.includes(shot.name));
const named = (name: string) => shots().find((shot) => shot.name === name);

// #4088: the Conversations page and a session's Messages tab, also with a refused send, had no
// print, so no axe check and no review of their states.
describe("the messaging prints (#4088)", () => {
  test("the table prints the Conversations page, the Messages tab with and without a refused send, ", () => {
    expect(shots().map((shot) => shot.name)).toEqual(NAMES);
  });

  test("the Conversations page opens as its own route, and the Messages tab on the session the demo gives messages to", () => {
    expect(named("conversas")?.route).toEqual({ name: "conversations" });
    for (const name of ["sessao-mensagens", "sessao-mensagens-recusa"]) {
      const route = named(name)?.route;
      expect(route?.name === "session" ? route.id : null).toBe("idle");
    }
  });

  test("the refused-send print answers the send with a refusal that carries its reason key, and the other one sends nothing", () => {
    expect(named("sessao-mensagens-recusa")?.wire).toEqual([
      {
        // Asked as a read, so the demo's host sends nothing and only the answer is the refusal.
        command: "messages.send",
        as: "messages.sessions",
        data: {
          id: expect.any(String),
          status: "refused",
          reason: expect.stringContaining("limit"),
          reasonKey: "messaging_limit_session",
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

// #4297: the states of the five fixes of the Messaging audit, and the long rule values, had no print.
describe("the Messaging state prints (#4297)", () => {
  const states = messagingShots(IDS);
  const find = (name: string) => states.find((shot) => shot.name === name);
  const COMMANDS = (name: string) => (find(name)?.wire ?? []).map((rule) => rule.command);

  test("the table prints each state once, in the order the audit lists them", () => {
    expect(states.map((shot) => shot.name)).toEqual([
      "conversas-cortada",
      "conversas-host-mudo",
      "conversas-filtro",
      "conversas-filtro-vazio",
      "sessao-mensagens-carregando",
      "sessao-mensagens-falhou",
      "sessao-mensagens-formulario",
      "configuracoes-mensagens-longos",
    ]);
  });

  test("the cut list gets a full page of the limit the page asks for, so the notice shows", () => {
    const rule = find("conversas-cortada")?.wire?.[0];
    const data = rule && "data" in rule ? (rule.data as { messages: unknown[] }) : null;
    expect(data?.messages.length).toBe(200);
    expect(find("conversas-cortada")?.route).toEqual({ name: "conversations" });
  });

  test("the silent-host print refuses the read on every host, since a rule is per command and not per host", () => {
    const rule = find("conversas-host-mudo")?.wire?.[0];
    expect(rule && "refuse" in rule ? rule.command : null).toBe("messages.list");
  });

  test("the Messages tab prints a stalled read, a refused read and the open form, on the session the demo gives messages to", () => {
    expect(COMMANDS("sessao-mensagens-carregando")).toEqual(["messages.list"]);
    // Held, not stalled: a held list keeps its status region, which the print waits out (#4190).
    const stalled = find("sessao-mensagens-carregando")?.wire?.[0];
    expect(stalled && "hold" in stalled).toBe(true);
    const refused = find("sessao-mensagens-falhou")?.wire?.[0];
    expect(refused && "refuse" in refused).toBe(true);
    for (const name of [
      "sessao-mensagens-carregando",
      "sessao-mensagens-falhou",
      "sessao-mensagens-formulario",
    ]) {
      const route = find(name)?.route;
      expect(route?.name === "session" ? route.id : null).toBe("idle");
    }
  });

  test("the long-value print gives Settings a 120-character selector and a pair of long session ids", () => {
    const rule = find("configuracoes-mensagens-longos")?.wire?.[0];
    const data =
      rule && "data" in rule
        ? (rule.data as {
            policy: { exceptions: Array<{ from: { project?: string } }> };
            paused: string[];
          })
        : null;
    expect(data?.policy.exceptions[0]?.from.project?.length).toBe(120);
    expect(data?.paused[0]?.split("|").every((address) => address.length > 40)).toBe(true);
  });

  test("the Conversations page and the long-value rows are re-measured narrow", () => {
    for (const name of ["conversas", "conversas-cortada", "configuracoes-mensagens-longos"]) {
      expect(NARROW_SHOTS).toContain(name);
    }
  });

  /** The calls a print's `prepare` makes on a page, in order, written out as text. */
  const callsOf = async (name: string): Promise<string[]> => {
    const calls: string[] = [];
    const text = (arg: unknown): string => {
      if (arg instanceof RegExp || typeof arg === "string") return String(arg);
      if (typeof arg === "object" && arg !== null) return Object.values(arg).map(text).join(",");
      return typeof arg;
    };
    const member = (call: string): unknown =>
      new Proxy(
        (...args: unknown[]) => {
          calls.push(`${call}(${args.map(text).join(",")})`);
          return recorder;
        },
        { get: (_target, prop) => (recorder as Record<string | symbol, unknown>)[prop] },
      );
    const recorder: unknown = new Proxy(() => recorder, {
      get: (_target, prop) => (prop === "then" ? undefined : member(String(prop))),
    });
    await find(name)?.prepare?.(recorder as never);
    return calls;
  };

  test("every state print waits for the state it shows before the shot is taken", async () => {
    const unwaited: string[] = [];
    for (const shot of states) {
      const calls = await callsOf(shot.name);
      if (!calls.some((call) => call.startsWith("waitFor("))) unwaited.push(shot.name);
    }
    expect(unwaited).toEqual([]);
  });

  test("the filter prints type their text into the filter box, and the empty one waits for the Clear filter button", async () => {
    const full = await callsOf("conversas-filtro");
    expect(full.some((call) => call.startsWith("fill(128"))).toBe(true);
    const none = await callsOf("conversas-filtro-vazio");
    expect(none.some((call) => call.startsWith("fill(zzzz"))).toBe(true);
    expect(none.some((call) => call.startsWith("getByRole(button") && call.includes("Clear"))).toBe(
      true,
    );
  });

  // LoadingState has no text node, only an accessible name, so a wait on text never resolves.
  test("the loading print waits for the status region by its name, not for text", async () => {
    const calls = await callsOf("sessao-mensagens-carregando");
    expect(calls.some((call) => call.startsWith("getByRole(status"))).toBe(true);
    expect(
      calls.some((call) => call.includes("Loading messages") && call.startsWith("getByText")),
    ).toBe(false);
  });

  // The Settings card shows its title while the rules load, so the print waits for the long value.
  test("the long-value print waits for the long path to be on screen after it opens the section", async () => {
    const calls = await callsOf("configuracoes-mensagens-longos");
    const section = calls.findIndex((call) => call.includes("Messages between sessions"));
    const value = calls.findIndex((call) => call.includes("billing-reconciliation-worker"));
    expect(section).toBeGreaterThan(-1);
    expect(value).toBeGreaterThan(section);
  });
});
