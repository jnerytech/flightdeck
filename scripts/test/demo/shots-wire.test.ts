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
      "linha-do-tempo-arquivos",
      "linha-do-tempo-desfeito",
      "linha-do-tempo-ocupado",
      "linha-do-tempo-falhou",
      "linha-do-tempo-vazia",
      "sino-painel",
      "sino-vazio",
      "sino-limpo",
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
      { command: "rewind.undoPreview", as: "rewind.preview" },
    ]);
    expect(named("linha-do-tempo-falhou")?.wire).toEqual([
      { command: "snapshots.list", refuse: expect.stringContaining("snapshot") },
    ]);
    expect(named("linha-do-tempo-vazia")?.wire).toEqual([
      { command: "snapshots.list", data: { snapshots: [] } },
    ]);
  });

  test("the bell prints with no notifications, and with the list cleared from a full one", () => {
    expect([named("sino-vazio")?.inbox, named("sino-limpo")?.inbox]).toEqual([undefined, true]);
  });
});
