import { describe, expect, test } from "bun:test";
import type { ExternalPermissionFrame, ExternalUpdated } from "@flightdeck/protocol";
import { ExternalSessionsSlice } from "../../src/features/sessions/index.ts";
import { translator } from "../../src/i18n/index.ts";
import type { AppState } from "../../src/lib/app-store.ts";

type Held = Pick<AppState, "hosts" | "externals" | "meta" | "externalRequests" | "hub">;

const session = (id: string, status = "running", cwd: string | null = "/work/api") => ({
  claudeSessionId: id,
  cwd,
  status,
});

const updated = (id: string, status = "running", extra: object = {}): ExternalUpdated =>
  ({ type: "external.updated", session: { ...session(id, status), ...extra } }) as never;

const request = (
  requestId: string,
  state: "open" | "closed" = "open",
  claudeSessionId = "c1",
): ExternalPermissionFrame =>
  ({
    type: "external.permission",
    requestId,
    claudeSessionId,
    toolName: "Bash",
    input: { command: "ls" },
    state,
  }) as never;

/** A slice over stand-ins: what the store holds, and what the webhooks and the person were told. */
function external(over: { focused?: boolean; held?: Partial<Held> } = {}) {
  let held: Held = {
    hosts: [{ id: "h1", name: "alfa" }],
    externals: {},
    meta: {},
    externalRequests: {},
    hub: {},
    ...over.held,
  } as never;
  const fed: string[] = [];
  const told: Array<{ about: { subject: string }; extra: unknown }> = [];
  const slice = new ExternalSessionsSlice({
    state: () => held,
    patch: (patch) => {
      held = { ...held, ...patch };
    },
    projectOf: (hostId, cwd) => (cwd === "/work/api" ? `${hostId}/p1` : undefined),
    isFocused: () => over.focused ?? false,
    t: () => translator("en"),
    notify: ((n: { about: { subject: string } }, _a: unknown, _b: unknown, extra: unknown) =>
      void told.push({ about: n.about, extra })) as never,
    feedSession: (host, prev, next) =>
      void fed.push(`session:${host.name}:${prev?.status ?? "-"}>${next.status}`),
    feedPermission: (host, frame, cwd) =>
      void fed.push(`permission:${host.name}:${frame.requestId}:${cwd}`),
  });
  return { slice, held: () => held, fed, told };
}

describe("external sessions slice", () => {
  test("a terminal session is kept as it is, with the name and pin that ride on its frame", () => {
    const { slice, held } = external();
    slice.onExternal("h1", updated("c1", "running", { meta: { name: "api work" } }));
    expect(held().externals["h1/c1"]?.status).toBe("running");
    expect(held().meta["h1/c1"]).toEqual({ name: "api work" } as never);
  });

  test("a frame with no meta leaves the names the app already has", () => {
    const { slice, held } = external({ held: { meta: { "h1/c1": { name: "kept" } } as never } });
    slice.onExternal("h1", updated("c1"));
    expect(held().meta["h1/c1"]).toEqual({ name: "kept" } as never);
  });

  test("the webhooks hear of a session on a known host, with what it was before", () => {
    const { slice, fed } = external();
    slice.onExternal("h1", updated("c1", "running"));
    slice.onExternal("h1", updated("c1", "ended"));
    slice.onExternal("ghost", updated("c9", "ended"));
    expect(fed).toEqual(["session:alfa:->running", "session:alfa:running>ended"]);
  });

  test("an open request stays in the queue, is fed to the webhooks and, out of focus, notified", () => {
    const { slice, held, fed, told } = external({
      held: { externals: { "h1/c1": session("c1") } as never },
    });
    slice.onExternal("h1", request("r1"));
    expect(Object.keys(held().externalRequests)).toEqual(["h1/r1"]);
    expect(fed).toEqual(["permission:alfa:r1:/work/api"]);
    expect(told).toHaveLength(1);
    expect(told[0]?.extra).toEqual({
      event: "needs-you",
      hostId: "h1",
      session: "h1/c1",
      project: "h1/p1",
    });
  });

  test("a window in front is told nothing, but the queue and the webhooks still hear", () => {
    const { slice, held, fed, told } = external({ focused: true });
    slice.onExternal("h1", request("r1"));
    expect(Object.keys(held().externalRequests)).toEqual(["h1/r1"]);
    expect(fed).toHaveLength(1);
    expect(told).toEqual([]);
  });

  test("a request with no folder carries no project in its notification", () => {
    const { slice, told } = external({
      held: { externals: { "h1/c1": session("c1", "running", null) } as never },
    });
    slice.onExternal("h1", request("r1"));
    expect(told[0]?.extra).toEqual({ event: "needs-you", hostId: "h1", session: "h1/c1" });
  });

  test("a closed request leaves the queue and says nothing", () => {
    const { slice, held, fed, told } = external();
    slice.onExternal("h1", request("r1"));
    fed.length = 0;
    told.length = 0;
    slice.onExternal("h1", request("r1", "closed"));
    expect(held().externalRequests).toEqual({});
    expect(fed).toEqual([]);
    expect(told).toEqual([]);
  });

  test("the notification names the session: its given name, else its title, its folder, its id", () => {
    const subjects = (held: Partial<Held>, id = "c1") => {
      const { slice, told } = external({ held });
      slice.onExternal("h1", request("r", "open", id));
      return told[0]?.about.subject;
    };
    expect(
      subjects({
        meta: { "h1/c1": { name: "given" } } as never,
        externals: { "h1/c1": session("c1") } as never,
      }),
    ).toBe("given");
    expect(
      subjects({
        hub: { h1: { history: [{ claudeSessionId: "c1", title: "from history" }] } } as never,
        externals: { "h1/c1": session("c1") } as never,
      }),
    ).toBe("from history");
    expect(subjects({ externals: { "h1/c1": session("c1") } as never })).toBe("api");
    expect(subjects({}, "abcdefghijkl")).toBe("abcdefgh");
  });
});
