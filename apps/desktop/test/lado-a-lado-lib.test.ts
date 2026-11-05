import { describe, expect, test } from "bun:test";
import type { HubRow } from "../src/lib/hub.ts";
import { emptySession, type SessionState } from "../src/lib/session-state.ts";
import { lastLines, pendingOf, pickTiles } from "../src/lib/tiles.ts";

const row = (n: number, over: Partial<HubRow> = {}): HubRow => ({
  key: `h/m/s${n}`,
  hostId: "h",
  hostName: "host",
  origin: "flightdeck",
  claudeSessionId: `c${n}`,
  sessionId: `s${n}`,
  title: `sessão ${n}`,
  cwd: "/p",
  projectKey: "proj",
  state: "idle",
  controllable: false,
  lastActivity: `2026-11-03T10:0${n}:00.000Z`,
  pinned: false,
  archived: false,
  summary: null,
  persona: null,
  ...over,
});

const project = { hostId: "h", projectKey: "proj" };

describe("lado-a-lado: which sessions the tiles show", () => {
  test("only the project's live managed sessions, the ones that need you first, then running, then idle", () => {
    const rows = [
      row(1, { state: "idle" }),
      row(2, { state: "running" }),
      row(3, { state: "needs_you" }),
      row(4, { state: "ended" }),
      row(5, { origin: "terminal", sessionId: null }),
      row(6, { projectKey: "outro" }),
      row(7, { hostId: "x" }),
      row(8, { archived: true }),
      row(9, { state: "idle", lastActivity: "2026-11-03T12:00:00.000Z" }),
    ];
    expect(pickTiles(rows, project, "2x3").map((r) => r.sessionId)).toEqual([
      "s3",
      "s2",
      "s9",
      "s1",
    ]);
  });

  test("a session whose key is still the folder's counts for the project by its folder (issue #105)", () => {
    // The daemon answers `known(cwd)` with the folder key until git has been asked: the project's
    // own key is the remote's, so the keys differ for the same folder.
    const real = { hostId: "h", projectKey: "github.com/acme/app", path: "/work/app" };
    const rows = [
      row(1, { cwd: "/work/app", projectKey: "host:alfa:/work/app" }),
      row(2, { cwd: "/work/app/sub", projectKey: "host:alfa:/work/app/sub" }),
      row(3, { cwd: "/work/app", projectKey: "github.com/acme/app" }),
      row(4, { cwd: "/work/other", projectKey: "host:alfa:/work/other" }),
      row(5, { cwd: "/work/application", projectKey: "host:alfa:/work/application" }),
      row(6, { hostId: "x", cwd: "/work/app", projectKey: "host:beta:/work/app" }),
    ];
    expect(
      pickTiles(rows, real, "auto")
        .map((r) => r.sessionId)
        .sort(),
    ).toEqual(["s1", "s2", "s3"]);
    // Without the path, only the key counts, as before.
    expect(
      pickTiles(rows, { hostId: "h", projectKey: real.projectKey }, "auto").map((r) => r.sessionId),
    ).toEqual(["s3"]);
  });

  test("it stops at the count, and the same state is ordered by the latest activity", () => {
    const rows = [1, 2, 3, 4, 5].map((n) => row(n, { state: "running" }));
    expect(pickTiles(rows, project, "2").map((r) => r.sessionId)).toEqual(["s5", "s4"]);
  });
});

describe("lado-a-lado: what a tile shows", () => {
  const withText = (text: string, streaming = ""): SessionState => ({
    ...emptySession(),
    streaming,
    items: [
      { kind: "user", seq: 1, text: "pergunta" },
      { kind: "assistant", seq: 2, blocks: [{ type: "text", text }] },
    ],
  });

  test("the last lines of the last message, without blank lines, at most four", () => {
    expect(lastLines(withText("a\n\nb\n  c  \nd\ne"))).toEqual(["b", "c", "d", "e"]);
    expect(lastLines(withText("a\nb\nc"), 2)).toEqual(["b", "c"]);
  });

  test("the text being streamed wins over the last message", () => {
    expect(lastLines(withText("velho", "novo\nainda escrevendo"))).toEqual([
      "novo",
      "ainda escrevendo",
    ]);
  });

  test("a session with nothing said has no lines", () => {
    expect(lastLines(emptySession())).toEqual([]);
  });

  test("the pending request is the first permission still open", () => {
    const base = emptySession();
    const asked = (requestId: string, resolved = false) => ({
      kind: "permission" as const,
      seq: 3,
      requestId,
      toolName: "Write",
      input: {} as never,
      ...(resolved ? { resolution: { decision: "allow" as const } } : {}),
    });
    const session: SessionState = {
      ...base,
      pending: ["r2"],
      items: [asked("r1", true), asked("r2")],
    };
    expect(pendingOf(session)).toEqual({ requestId: "r2", toolName: "Write" });
    expect(pendingOf({ ...session, pending: [] })).toBeNull();
    expect(pendingOf(base)).toBeNull();
  });
});
