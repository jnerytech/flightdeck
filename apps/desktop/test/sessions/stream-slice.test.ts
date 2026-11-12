import { describe, expect, test } from "bun:test";
import type { EventEnvelope, SessionSubscribeResult } from "@flightdeck/protocol";
import { SessionStreamSlice } from "../../src/features/sessions/index.ts";
import { emptySession, type SessionState } from "../../src/features/sessions/session-state.ts";

const said = (seq: number, sessionId = "s1"): EventEnvelope =>
  ({
    type: "event",
    sessionId,
    seq,
    ts: "2026-11-11T10:00:00.000Z",
    event: { type: "message.assistant", blocks: [{ type: "text", text: `reply ${seq}` }] },
  }) as unknown as EventEnvelope;

const word = (seq: number, text: string): EventEnvelope =>
  ({
    type: "event",
    sessionId: "s1",
    seq,
    ts: "2026-11-11T10:00:00.000Z",
    event: { type: "message.delta", text },
  }) as unknown as EventEnvelope;

const summary = (): EventEnvelope =>
  ({
    type: "event",
    sessionId: "s1",
    seq: 0,
    ts: "2026-11-11T10:00:00.000Z",
    event: { type: "session.summary", sessionId: "s1" },
  }) as unknown as EventEnvelope;

/** A stream over stand-ins: the conversations it holds, the summaries it passed on, the replays it asked. */
function stream(start: Record<string, SessionState> = {}) {
  let sessions = start;
  const summaries: string[] = [];
  const resyncs: string[] = [];
  const slice = new SessionStreamSlice({
    sessions: () => sessions,
    setSessions: (next) => {
      sessions = next;
    },
    summary: (hostId, event) => void summaries.push(`${hostId}:${event.type}`),
    resync: (hostId, sessionId) => void resyncs.push(`${hostId}/${sessionId}`),
  });
  return { slice, held: () => sessions, summaries, resyncs };
}

const following = (lastSeq: number): Record<string, SessionState> => ({
  "h1/s1": { ...emptySession(), lastSeq },
});

describe("session stream slice", () => {
  test("events apply in order and a repeat changes nothing", () => {
    const { slice, held } = stream(following(0));
    slice.onEvent("h1", said(1));
    slice.onEvent("h1", said(2));
    slice.onEvent("h1", said(2));
    expect(held()["h1/s1"]?.items.map((i) => i.seq)).toEqual([1, 2]);
  });

  test("a summary goes to the sidebar and never makes a conversation", () => {
    const { slice, held, summaries } = stream();
    slice.onEvent("h1", summary());
    expect(summaries).toEqual(["h1:session.summary"]);
    expect(held()).toEqual({});
  });

  test("a frame that skips a seq is not applied, and the host is asked once for the replay", () => {
    const { slice, held, resyncs } = stream(following(4));
    slice.onEvent("h1", said(6));
    slice.onEvent("h1", said(7));
    expect(resyncs).toEqual(["h1/s1"]);
    expect(held()["h1/s1"]?.lastSeq).toBe(4);
  });

  test("the replay fills the hole: the next frame that fits is applied and the ask is forgotten", () => {
    const { slice, held, resyncs } = stream(following(4));
    slice.onEvent("h1", said(6));
    slice.onEvent("h1", said(5));
    slice.onEvent("h1", said(6));
    slice.onEvent("h1", said(9));
    expect(held()["h1/s1"]?.items.map((i) => i.seq)).toEqual([5, 6]);
    expect(resyncs).toEqual(["h1/s1", "h1/s1"]);
  });

  test("a hole the host answered and could not fill is marked in the conversation", () => {
    const { slice, held } = stream(following(4));
    slice.onEvent("h1", said(6));
    slice.onSubscribed("h1", "s1", {
      replayed: 0,
      session: { lastSeq: 6, status: "idle", cwd: "/w" },
    } as unknown as SessionSubscribeResult);
    slice.onEvent("h1", said(6));
    expect(held()["h1/s1"]?.items.map((i) => i.kind)).toEqual(["gap", "assistant"]);
  });

  test("a streamed word is never a gap and never counts in the seq", () => {
    const { slice, held, resyncs } = stream(following(4));
    slice.onEvent("h1", word(9, "hel"));
    slice.onEvent("h1", word(9, "lo"));
    expect(held()["h1/s1"]?.streaming).toBe("hello");
    expect(held()["h1/s1"]?.lastSeq).toBe(4);
    expect(resyncs).toEqual([]);
  });

  test("a session that had events but replays none says its history was pruned", () => {
    const { slice, held } = stream();
    slice.onSubscribed("h1", "s9", {
      replayed: 0,
      session: { lastSeq: 12, status: "idle", cwd: "/work" },
    } as unknown as SessionSubscribeResult);
    expect(held()["h1/s9"]).toMatchObject({ pruned: true, status: "idle", cwd: "/work" });
  });

  test("a replay that brought events, or a session we already follow, is not pruned", () => {
    const { slice, held } = stream(following(3));
    const result = (replayed: number, lastSeq: number) =>
      ({
        replayed,
        session: { lastSeq, status: "idle", cwd: "/w" },
      }) as unknown as SessionSubscribeResult;
    slice.onSubscribed("h1", "s1", result(0, 9));
    slice.onSubscribed("h1", "s2", result(4, 9));
    slice.onSubscribed("h1", "s3", result(0, 0));
    expect(held()["h1/s1"]?.pruned).toBeUndefined();
    expect(held()["h1/s2"]).toBeUndefined();
    expect(held()["h1/s3"]).toBeUndefined();
  });

  test("a drop ends the half-written text of that host's sessions only", () => {
    const { slice, held } = stream({
      "h1/s1": { ...emptySession(), streaming: "half" },
      "h2/s1": { ...emptySession(), streaming: "other" },
    });
    slice.dropPartialText("h1");
    expect(held()["h1/s1"]?.streaming).toBe("");
    expect(held()["h2/s1"]?.streaming).toBe("other");
  });
});
