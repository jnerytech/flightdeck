import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { agentShots } from "../../lib/shots/table-agent.ts";
import { type WireRule, wireRewriter, wireScript } from "../../lib/shots/wire.ts";

/**
 * #3982: the Timeline sheet and the bell have states the demo's hosts cannot be left in (a refused
 * read, an empty history, a rewind that was applied and can be undone). The print wraps the page's
 * sockets and changes what one command does, so no host is touched and every machine prints the same.
 */
const ask = (id: string, type: string, payload: object = {}) =>
  JSON.stringify({ id, type, payload });
const ack = (id: string, data: object) => JSON.stringify({ type: "ack", id, ok: true, data });
const read = (frame: string) => JSON.parse(frame) as Record<string, unknown>;

describe("shots-wire: what a rule does to one command", () => {
  test("a refused command answers ok false with the text, and no data", () => {
    const rules: WireRule[] = [{ command: "snapshots.list", refuse: "git is not here" }];
    const wire = wireRewriter(rules);
    wire.fromApp(ask("r1", "snapshots.list"));
    expect(read(wire.fromHost(ack("r1", { snapshots: [] })))).toEqual({
      type: "ack",
      id: "r1",
      ok: false,
      error: { code: "unavailable", message: "git is not here" },
    });
  });

  test("a replaced answer keeps the ack and swaps its data", () => {
    const wire = wireRewriter([{ command: "snapshots.list", data: { snapshots: [] } }]);
    wire.fromApp(ask("r1", "snapshots.list"));
    expect(read(wire.fromHost(ack("r1", { snapshots: [{ n: 1 }] })))).toEqual({
      type: "ack",
      id: "r1",
      ok: true,
      data: { snapshots: [] },
    });
  });

  test("a request sent as another command keeps its id and payload, and its answer comes back as it is", () => {
    const wire = wireRewriter([{ command: "rewind.apply", as: "rewind.preview" }]);
    const sent = wire.fromApp(ask("r1", "rewind.apply", { turn: 2, confirm: true }));
    const answer = ack("r1", { via: "snapshot", files: [], insertions: 0, deletions: 0 });
    expect([read(sent), wire.fromHost(answer)]).toEqual([
      { id: "r1", type: "rewind.preview", payload: { turn: 2, confirm: true } },
      answer,
    ]);
  });

  test("other commands, events and frames that are not JSON pass as they came", () => {
    const wire = wireRewriter([{ command: "snapshots.list", refuse: "x" }]);
    const other = ask("r1", "project.list");
    const answer = ack("r1", { projects: [] });
    const event = JSON.stringify({ type: "board.updated", id: "r2" });
    expect([
      wire.fromApp(other),
      wire.fromApp("not json"),
      wire.fromHost(answer),
      wire.fromHost(event),
      wire.fromHost("{"),
    ]).toEqual([other, "not json", answer, event, "{"]);
  });

  test("a refusal from the host and a second answer to the same request pass as they came", () => {
    const wire = wireRewriter([{ command: "snapshots.list", data: { snapshots: [] } }]);
    const refusal = JSON.stringify({ type: "ack", id: "r1", ok: false, error: { code: "x" } });
    wire.fromApp(ask("r1", "snapshots.list"));
    wire.fromApp(ask("r2", "snapshots.list"));
    const first = read(wire.fromHost(ack("r2", { snapshots: [{ n: 1 }] })));
    const again = ack("r2", { snapshots: [{ n: 1 }] });
    expect([wire.fromHost(refusal), first.data, wire.fromHost(again)]).toEqual([
      refusal,
      { snapshots: [] },
      again,
    ]);
  });
});

/** A socket that records what the app sends and lets the test play the host's frames. */
class FakeSocket {
  sent: string[] = [];
  listeners: Array<(event: { data: unknown }) => void> = [];
  send(data: string) {
    this.sent.push(data);
  }
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    if (type === "message") this.listeners.push(listener);
  }
  play(data: unknown) {
    for (const listener of this.listeners) listener({ data });
  }
}

describe("shots-wire: the page's WebSocket", () => {
  const rules: WireRule[] = [
    { command: "rewind.apply", as: "rewind.preview" },
    { command: "snapshots.list", refuse: "no repository" },
  ];

  test("the init script alone wraps the socket: the host gets the rewritten request, the app the rewritten answer", () => {
    const page = { WebSocket: FakeSocket as unknown as typeof WebSocket };
    new Function("window", wireScript(rules))(page);
    const socket = new page.WebSocket("ws://x") as unknown as FakeSocket;
    const got: unknown[] = [];
    socket.addEventListener("message", (event) => got.push(event.data));
    socket.send(ask("r1", "rewind.apply", { turn: 1 }));
    socket.send(ask("r2", "snapshots.list"));
    socket.play(ack("r2", { snapshots: [] }));
    expect([
      socket.sent.map((frame) => read(frame).type),
      got.map((frame) => read(String(frame)).ok),
    ]).toEqual([["rewind.preview", "snapshots.list"], [false]]);
  });

  test("the rewriter's source stands alone, and the script calls no transpile helper", () => {
    const fromSource = (): unknown => {
      try {
        const make = new Function(`return (${wireRewriter.toString()})`)();
        return read(make(rules).fromApp(ask("r1", "rewind.apply"))).type;
      } catch (error) {
        return String(error);
      }
    };
    expect([fromSource(), wireScript(rules).match(/\b__\w+/g) ?? []]).toEqual([
      "rewind.preview",
      [],
    ]);
  });
});

describe("shots-wire: a held, a replied, a sequenced and a trimmed command (#4154)", () => {
  test("the answer to a held command never reaches the app, and the others' answers do", () => {
    const wire = wireRewriter([{ command: "approval.list", hold: true }]);
    wire.fromApp(ask("r1", "approval.list"));
    wire.fromApp(ask("r2", "project.list"));
    expect([
      wire.drops?.(ack("r1", { keys: [] })),
      wire.drops?.(ack("r2", { projects: [] })),
      wire.drops?.(JSON.stringify({ type: "board.updated" })),
      wire.drops?.("{"),
    ]).toEqual([true, false, false, false]);
  });

  test("a replied command is answered in the page with the rule's data, and any other frame is left to the host", () => {
    const wire = wireRewriter([{ command: "approval.revoke", reply: { revoked: true } }]);
    const revoke = ask("r1", "approval.revoke", { keyId: "k" });
    expect([
      wire.fromApp(revoke),
      wire.answer?.(revoke),
      wire.answer?.(ask("r2", "approval.list")),
      wire.answer?.("not json"),
    ]).toEqual([
      revoke,
      JSON.stringify({ type: "ack", id: "r1", ok: true, data: { revoked: true } }),
      undefined,
      undefined,
    ]);
  });

  test("a reply's `{in Ns}` is the time N seconds from the answer, so an offer that expires reads its real length (#4229)", () => {
    const wire = wireRewriter([
      { command: "changes.revert", reply: { path: "a.ts", undoUntil: "{in 25s}" } },
    ]);
    const before = Date.now();
    const reply = JSON.parse(wire.answer?.(ask("r1", "changes.revert")) ?? "{}") as {
      data: { path: string; undoUntil: string };
    };
    const left = Date.parse(reply.data.undoUntil) - before;
    expect([reply.data.path, left >= 25_000 && left < 27_000]).toEqual(["a.ts", true]);
  });

  test("a reply's `{in -Ns}` is the time N seconds before the answer, so a step that started a minute ago reads a minute (#4287)", () => {
    const wire = wireRewriter([{ command: "run.get", reply: { startedAt: "{in -90s}" } }]);
    const before = Date.now();
    const reply = JSON.parse(wire.answer?.(ask("r1", "run.get")) ?? "{}") as {
      data: { startedAt: string };
    };
    const age = before - Date.parse(reply.data.startedAt);
    expect(age >= 89_000 && age < 92_000).toBe(true);
  });

  test("a reply with nothing to say is an answer with no data, not a crash (#4229)", () => {
    const wire = wireRewriter([{ command: "changes.revert", reply: undefined }]);
    expect(JSON.parse(wire.answer?.(ask("r1", "changes.revert")) ?? "{}")).toEqual({
      type: "ack",
      id: "r1",
      ok: true,
    });
  });

  test("a rejected command is answered in the page with a refusal that carries the rule's text, and a stalled one is held back (#4203)", () => {
    const wire = wireRewriter([
      { command: "permission.respond", reject: "not open here" },
      { command: "session.interrupt", stall: true },
    ]);
    const respond = ask("r1", "permission.respond");
    const interrupt = ask("r2", "session.interrupt");
    expect([
      wire.answer?.(respond),
      wire.answer?.(interrupt),
      wire.swallows?.(interrupt),
      wire.swallows?.(respond),
      wire.swallows?.(ask("r3", "approval.list")),
    ]).toEqual([
      JSON.stringify({
        type: "ack",
        id: "r1",
        ok: false,
        error: { code: "unavailable", message: "not open here" },
      }),
      undefined,
      true,
      false,
      false,
    ]);
  });

  test("the page's socket sends neither a rejected nor a stalled command, and only the rejected one is answered (#4203)", async () => {
    const page = { WebSocket: FakeSocket as unknown as typeof WebSocket };
    new Function(
      "window",
      wireScript([
        { command: "permission.respond", reject: "no" },
        { command: "session.interrupt", stall: true },
      ]),
    )(page);
    const socket = new page.WebSocket("ws://x") as unknown as FakeSocket;
    const got: unknown[] = [];
    socket.addEventListener("message", (event) => got.push(event.data));
    socket.send(ask("r1", "permission.respond"));
    socket.send(ask("r2", "session.interrupt"));
    await Promise.resolve();
    expect([socket.sent, got.length]).toEqual([[], 1]);
  });

  test("a rule with after answers the first read with its data and every later one with after", () => {
    const wire = wireRewriter([
      { command: "approval.list", data: { keys: ["a"] }, after: { keys: [] } },
    ]);
    const answers = ["r1", "r2", "r3"].map((id) => {
      wire.fromApp(ask(id, "approval.list"));
      return read(wire.fromHost(ack(id, { keys: ["real"] }))).data;
    });
    expect(answers).toEqual([{ keys: ["a"] }, { keys: [] }, { keys: [] }]);
  });

  test("without takes the named entries out of an array of the answer and keeps everything else", () => {
    const wire = wireRewriter([{ command: "host.info", without: { features: ["b", "c"] } }]);
    wire.fromApp(ask("r1", "host.info"));
    expect(
      read(wire.fromHost(ack("r1", { name: "alfa", features: ["a", "b", "c", "d"] }))),
    ).toEqual({ type: "ack", id: "r1", ok: true, data: { name: "alfa", features: ["a", "d"] } });
  });

  test("the page's socket never sends a replied command and answers it to the app", async () => {
    const page = { WebSocket: FakeSocket as unknown as typeof WebSocket };
    new Function("window", wireScript([{ command: "approval.revoke", reply: {} }]))(page);
    const socket = new page.WebSocket("ws://x") as unknown as FakeSocket;
    const got: unknown[] = [];
    socket.addEventListener("message", (event) => got.push(event.data));
    socket.send(ask("r1", "approval.revoke"));
    await Promise.resolve();
    expect([socket.sent, got]).toEqual([
      [],
      [JSON.stringify({ type: "ack", id: "r1", ok: true, data: {} })],
    ]);
  });
});

describe("shots-wire: the states the table prints (#3982)", () => {
  const IDS = { rewindSession: "rw", waitingSession: "wt" } as DemoIds;
  const shots = () =>
    agentShots(IDS).filter(
      (shot) => shot.name.startsWith("linha-do-tempo") || shot.name.startsWith("sino-"),
    );
  const named = (name: string) => shots().find((shot) => shot.name === name);

  test("the Timeline prints its files, the applied rewind, the busy session, the refused read and the empty one", () => {
    expect(shots().map((shot) => shot.name)).toEqual([
      "linha-do-tempo",
      "linha-do-tempo-voltar",
      "linha-do-tempo-bifurcar",
      "linha-do-tempo-bifurcar-arquivos",
      "linha-do-tempo-bifurcar-recusa",
      "linha-do-tempo-bifurcado",
      "linha-do-tempo-arquivos",
      "linha-do-tempo-desfeito",
      "linha-do-tempo-ocupado",
      "linha-do-tempo-falhou",
      "linha-do-tempo-vazia",
      "sino-painel",
      "sino-vazio",
      "sino-limpo",
      "sino-recusa",
      "sino-alto-risco",
      "sino-respondendo",
    ]);
  });

  test("the busy print opens the session that waits for a permission, and the others the one with turns", () => {
    const ids = (name: string) => {
      const route = named(name)?.route;
      return route?.name === "session" ? route.id : null;
    };
    expect([
      ids("linha-do-tempo-ocupado"),
      ids("linha-do-tempo-arquivos"),
      ids("linha-do-tempo-desfeito"),
      ids("linha-do-tempo-falhou"),
      ids("linha-do-tempo-vazia"),
    ]).toEqual(["wt", "rw", "rw", "rw", "rw"]);
  });

  test("the applied rewind is sent as a preview, and so is the undo preview that offers the Undo (#4036), the refused and the empty read change the list", () => {
    expect(named("linha-do-tempo-desfeito")?.wire).toEqual([
      { command: "rewind.apply", as: "rewind.preview" },
      // The Undo comes from the host's undo preview, and the demo's host has no rewind to undo.
      {
        command: "rewind.undoPreview",
        as: "snapshots.list",
        data: {
          via: "snapshot",
          files: [
            { path: "README.md", change: "modified" },
            { path: "src/cart.ts", change: "deleted" },
          ],
          insertions: expect.any(Number),
          deletions: expect.any(Number),
        },
      },
    ]);
    expect(named("linha-do-tempo-falhou")?.wire).toEqual([
      { command: "snapshots.list", refuse: expect.stringContaining("snapshot") },
    ]);
    expect(named("linha-do-tempo-vazia")?.wire).toEqual([
      { command: "snapshots.list", data: { snapshots: [] } },
    ]);
  });

  test("the applied-rewind print waits for the notice that says the rewind happened before it waits for the Undo, which the undo preview shows from the start (#4036)", async () => {
    const calls: string[] = [];
    // An options object reads as its values, so the button's name is in the call.
    const text = (arg: unknown): string => {
      if (arg instanceof RegExp || typeof arg === "string") return String(arg);
      if (typeof arg === "object" && arg !== null) return Object.values(arg).map(text).join(",");
      return typeof arg;
    };
    // A page that records each call and answers with itself, also for `page.mouse.move(...)`.
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
    await named("linha-do-tempo-desfeito")?.prepare?.(recorder as never);
    const notice = calls.findIndex(
      (call) => call.startsWith("getByText(") && call.includes("voltados"),
    );
    const undo = calls.findIndex((call) => call.includes("Undo rewind"));
    expect(notice).toBeGreaterThan(-1);
    expect(undo).toBeGreaterThan(notice);
  });

  test("the bell prints with no notifications, and with the list cleared from a full one", () => {
    expect([named("sino-vazio")?.inbox, named("sino-limpo")?.inbox]).toEqual([undefined, true]);
  });

  test("the bell prints a refused answer and an answer on its way from the host's answer to Approve (#4203)", () => {
    expect(named("sino-recusa")?.inbox).toBe(true);
    expect(named("sino-recusa")?.wire?.map((rule) => rule.command)).toEqual(["permission.respond"]);
    expect(named("sino-recusa")?.wire?.some((rule) => "reject" in rule && rule.reject !== "")).toBe(
      true,
    );
    expect(named("sino-respondendo")?.inbox).toBe(true);
    expect(named("sino-respondendo")?.wire).toEqual([
      { command: "permission.respond", stall: true },
    ]);
  });

  test("the bell prints a high-risk request from the dangerous command's row, which the other bell prints leave out (#4203)", () => {
    expect(named("sino-alto-risco")?.inbox).toBe("danger");
    expect(named("sino-painel")?.inbox).toBe(true);
  });
});
