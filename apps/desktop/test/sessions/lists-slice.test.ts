import { describe, expect, test } from "bun:test";
import type { HostConnection } from "../../src/features/hosts/host-connection.ts";
import { SessionListsSlice } from "../../src/features/sessions/index.ts";
import type { AppState } from "../../src/lib/app-store.ts";

type Held = Pick<AppState, "hosts" | "hub" | "names" | "meta" | "externals" | "background">;

/** What a host answers to each list, by request type; a type left out answers "busy" (it throws). */
type Answers = Record<string, unknown>;

const managed = (id: string, meta?: object) => ({ id, claudeSessionId: `c-${id}`, meta });
const external = (id: string, lastEventAt: string, meta?: object) => ({
  claudeSessionId: id,
  lastEventAt,
  ...(meta ? { meta } : {}),
});

function host(id: string, over: { status?: string; features?: string[] } = {}) {
  return {
    id,
    name: id,
    status: over.status ?? "online",
    hostInfo: { features: over.features ?? ["names", "bg"] },
  };
}

/** A slice over stand-ins: what the store holds, the hosts' answers, and each change it was told. */
function lists(hosts: ReturnType<typeof host>[], answers: Record<string, Answers>) {
  let held = {
    hosts,
    hub: {},
    names: {},
    meta: {},
    externals: {},
    background: {},
  } as unknown as Held;
  const patches: Array<Partial<Held>> = [];
  const asked: string[] = [];
  const slice = new SessionListsSlice({
    state: () => held,
    patch: (patch) => {
      patches.push(patch);
      held = { ...held, ...patch };
    },
    connection: (hostId) =>
      ({
        request: async (type: string) => {
          asked.push(`${hostId}:${type}`);
          if (!(type in (answers[hostId] ?? {}))) throw new Error("busy");
          return answers[hostId]?.[type];
        },
      }) as unknown as HostConnection,
    backgroundPatch: (hostId, list) =>
      JSON.stringify(held.background[hostId]) === JSON.stringify(list)
        ? null
        : { background: { ...held.background, [hostId]: list } },
  });
  return { slice, held: () => held, patches, asked };
}

describe("the session lists slice", () => {
  test("the lists of an online host go into the state: managed, history, names, background and meta", async () => {
    const { slice, held } = lists([host("h1")], {
      h1: {
        "session.list": { sessions: [managed("m1", { name: "api work" })] },
        "history.list": { sessions: [{ claudeSessionId: "c-old", meta: { pinned: true } }] },
        "external.list": { sessions: [external("e1", "2026-11-11T10:00:00Z", { name: "term" })] },
        "names.list": { names: [{ name: "refactor" }] },
        "bg.list": { sessions: [{ id: "b1" }] },
      },
    });
    await slice.refresh();
    expect(held().hub.h1?.managed).toHaveLength(1);
    expect(held().hub.h1?.history).toHaveLength(1);
    expect(held().names.h1).toEqual([{ name: "refactor" }] as never);
    expect(held().background.h1).toEqual({ sessions: [{ id: "b1" }] } as never);
    expect(held().meta["h1/c-m1"]).toEqual({ name: "api work" } as never);
    expect(held().meta["h1/c-old"]).toEqual({ pinned: true } as never);
    expect(held().meta["h1/e1"]).toEqual({ name: "term" } as never);
    expect(held().externals["h1/e1"]?.claudeSessionId).toBe("e1");
  });

  test("a second look that finds the same lists tells nobody", async () => {
    const answers = {
      h1: {
        "session.list": { sessions: [managed("m1", { name: "api work" })] },
        "history.list": { sessions: [{ claudeSessionId: "c-old", meta: { pinned: true } }] },
        "external.list": { sessions: [external("e1", "2026-11-11T10:00:00Z", { name: "term" })] },
        "names.list": { names: [{ name: "refactor" }] },
        "bg.list": { sessions: [{ id: "b1" }] },
      },
    };
    const { slice, patches } = lists([host("h1")], answers);
    await slice.refresh();
    expect(patches).toHaveLength(1);
    await slice.refresh();
    expect(patches).toHaveLength(1);
  });

  test("a request that failed keeps the list the state holds; an empty answer empties it", async () => {
    const full = { sessions: [managed("m1")] };
    const answers: Record<string, Answers> = {
      h1: {
        "session.list": full,
        "history.list": { sessions: [] },
        "external.list": { sessions: [] },
        "names.list": { names: [] },
        "bg.list": { sessions: [] },
      },
    };
    const { slice, held } = lists([host("h1")], answers);
    await slice.refresh();
    delete answers.h1?.["session.list"]; // a busy host
    await slice.refresh();
    expect(held().hub.h1?.managed).toHaveLength(1);
    answers.h1 = { ...answers.h1, "session.list": { sessions: [] } };
    await slice.refresh();
    expect(held().hub.h1?.managed).toEqual([]);
  });

  test("a terminal session read before a frame, answered after it, does not undo the frame", async () => {
    const answers = {
      h1: {
        "session.list": { sessions: [] },
        "history.list": { sessions: [] },
        "external.list": { sessions: [external("e1", "2026-11-11T09:00:00Z")] },
      },
    };
    const { slice, held } = lists([host("h1", { features: [] })], answers);
    const newer = external("e1", "2026-11-11T10:00:00Z");
    (held() as { externals: Record<string, unknown> }).externals = { "h1/e1": newer };
    await slice.refresh();
    expect(held().externals["h1/e1"]).toBe(newer as never);
  });

  test("only the online hosts are asked, and only for what their daemon announces", async () => {
    const answers = {
      h1: { "session.list": { sessions: [] }, "history.list": { sessions: [] } },
    };
    const { slice, asked } = lists(
      [host("h1", { features: [] }), host("h2", { status: "offline" })],
      answers,
    );
    await slice.refresh();
    expect(asked.sort()).toEqual(["h1:external.list", "h1:history.list", "h1:session.list"]);
  });
});
