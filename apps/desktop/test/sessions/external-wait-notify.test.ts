import { describe, expect, test } from "bun:test";
import type { ExternalPermissionFrame, ExternalUpdated } from "@flightdeck/protocol";
import { ExternalSessionsSlice } from "../../src/features/sessions/index.ts";
import { translator } from "../../src/i18n/index.ts";
import type { AppState } from "../../src/lib/app-store.ts";

/**
 * Issue #1751: a terminal session that starts waiting at a plan approval or a question reaches the
 * person as a notification, as its permission requests already do. The app can only open it: the
 * notification's click goes to the session.
 */
type Held = Pick<AppState, "hosts" | "externals" | "meta" | "externalRequests" | "hub">;

const updated = (over: Record<string, unknown> = {}): ExternalUpdated =>
  ({
    type: "external.updated",
    session: { claudeSessionId: "c1", cwd: "/work/api", status: "idle", ...over },
  }) as never;

const request = (): ExternalPermissionFrame =>
  ({
    type: "external.permission",
    requestId: "r1",
    claudeSessionId: "c1",
    toolName: "ExitPlanMode",
    input: {},
    state: "open",
  }) as never;

interface Told {
  title: string;
  body: string;
  about: unknown;
  route: unknown;
  source: unknown;
}

function setup(over: { focused?: boolean; lang?: "en" | "pt-BR"; held?: Partial<Held> } = {}) {
  let held: Held = {
    hosts: [{ id: "h1", name: "alfa" }],
    externals: {},
    meta: { "h1/c1": { name: "api work" } },
    externalRequests: {},
    hub: {},
    ...over.held,
  } as never;
  const told: Told[] = [];
  const slice = new ExternalSessionsSlice({
    state: () => held,
    patch: (patch) => {
      held = { ...held, ...patch };
    },
    projectOf: (hostId, cwd) => (cwd === "/work/api" ? `${hostId}/p1` : undefined),
    isFocused: () => over.focused ?? false,
    t: () => translator(over.lang ?? "en"),
    notify: ((n: Told, route: unknown, _fallback: unknown, source: unknown) =>
      void told.push({
        title: n.title,
        body: n.body,
        about: n.about,
        route,
        source,
      })) as never,
    feedSession: () => {},
    feedPermission: () => {},
  });
  return { slice, told };
}

describe("external-wait-notify: a terminal session that starts waiting is told to the person (#1751)", () => {
  test("a plan approval is notified once, with the session, the host and a click to open it", () => {
    const { slice, told } = setup();
    slice.onExternal("h1", updated({ waiting: "plan" }));
    expect(told).toEqual([
      {
        title: "Needs you",
        body: "alfa · plan waiting for your approval",
        about: {
          subject: "api work",
          host: "alfa",
          ask: "plan waiting for your approval",
          group: "h1/c1",
        },
        route: { name: "external", host: "h1", claudeSessionId: "c1" },
        source: { event: "needs-you", hostId: "h1", session: "h1/c1", project: "h1/p1" },
      },
    ]);
  });

  test("a question says so, in the language of the app", () => {
    const { slice, told } = setup({ lang: "pt-BR" });
    slice.onExternal("h1", updated({ waiting: "question" }));
    expect(told.map((n) => n.body)).toEqual(["alfa · tem uma pergunta para você"]);
  });

  test("the same wait told again by the host is not notified again", () => {
    const { slice, told } = setup();
    slice.onExternal("h1", updated({ waiting: "plan" }));
    slice.onExternal("h1", updated({ waiting: "plan", lastEventAt: "2026-11-13T12:00:00Z" }));
    expect(told).toHaveLength(1);
  });

  test("a new wait is notified: another kind, or the same kind after it was answered", () => {
    const { slice, told } = setup();
    slice.onExternal("h1", updated({ waiting: "plan" }));
    slice.onExternal("h1", updated({ waiting: "question" }));
    slice.onExternal("h1", updated({ waiting: null }));
    slice.onExternal("h1", updated({ waiting: "question" }));
    expect(told.map((n) => n.about && (n.about as { ask: string }).ask)).toEqual([
      "plan waiting for your approval",
      "has a question for you",
      "has a question for you",
    ]);
  });

  test("a window in front is told nothing", () => {
    const { slice, told } = setup({ focused: true });
    slice.onExternal("h1", updated({ waiting: "plan" }));
    expect(told).toEqual([]);
  });

  test("a session waiting for nothing, or one that has ended, says nothing", () => {
    const { slice, told } = setup();
    slice.onExternal("h1", updated({ waiting: null }));
    slice.onExternal("h1", updated({ claudeSessionId: "c2" }));
    slice.onExternal("h1", updated({ claudeSessionId: "c3", status: "ended" }));
    expect(told).toEqual([]);
  });

  test("a plan whose hook request is open is told by that request, not twice", () => {
    const { slice, told } = setup();
    slice.onExternal("h1", request());
    told.length = 0;
    slice.onExternal("h1", updated({ waiting: "plan" }));
    expect(told).toEqual([]);
  });

  test("a session with no name and no folder is named by its id", () => {
    const { slice, told } = setup({ held: { meta: {} } });
    slice.onExternal(
      "h1",
      updated({ claudeSessionId: "abcdef123456", cwd: null, waiting: "plan" }),
    );
    expect(told.map((n) => (n.about as { subject: string }).subject)).toEqual(["abcdef12"]);
  });
});
