import { describe, expect, test } from "bun:test";
import { SessionCommandsSlice } from "../../src/features/sessions/index.ts";
import type { HostConnection } from "../../src/lib/host-connection.ts";
import { settle } from "../wait.ts";

type Sent = { type: string; payload: Record<string, unknown> };

/** A slice over stand-ins: a host that records its requests, and what the store was told. */
function commands(
  over: {
    selected?: { hostId: string; sessionId: string | null } | null;
    connected?: boolean;
    refuse?: string;
  } = {},
) {
  const sent: Sent[] = [];
  const failures: Array<{ message: string; retry: boolean }> = [];
  const opened: string[] = [];
  const retries: Array<() => void> = [];
  const conn = {
    request: async (type: string, payload: Record<string, unknown>) => {
      sent.push({ type, payload });
      if (over.refuse) throw new Error(over.refuse);
      return { sessionId: "s-new" };
    },
  } as unknown as HostConnection;
  const connected = over.connected ?? true;
  const slice = new SessionCommandsSlice({
    connection: (hostId) => (connected && hostId === "h1" ? conn : undefined),
    selected: () =>
      over.selected === undefined ? { hostId: "h1", sessionId: "s1" } : over.selected,
    fail: (error, _text, retry) => {
      failures.push({ message: (error as Error).message, retry: retry !== undefined });
      if (retry) retries.push(retry);
    },
    opened: (hostId, sessionId) => void opened.push(`${hostId}/${sessionId}`),
  });
  return { slice, sent, failures, opened, retries };
}

describe("session commands slice", () => {
  test("a new session opens on the host that made it", async () => {
    const { slice, sent, opened } = commands();
    const id = await slice.create("h1", { cwd: "/work/api" } as never);
    expect(id).toBe("s-new");
    expect(sent.map((s) => s.type)).toEqual(["session.create"]);
    expect(opened).toEqual(["h1/s-new"]);
  });

  test("a host with no connection refuses as offline and nothing opens", async () => {
    const { slice, failures, opened } = commands({ connected: false });
    expect(await slice.create("h1", {} as never)).toBeNull();
    expect(failures.map((f) => f.message)).toEqual(["unknown host, or no token"]);
    expect(opened).toEqual([]);
  });

  test("a refused create says why and offers the same create again", async () => {
    const { slice, sent, failures, retries } = commands({ refuse: "no room" });
    expect(await slice.create("h1", {} as never)).toBeNull();
    expect(failures).toEqual([{ message: "no room", retry: true }]);
    expect(sent).toHaveLength(1);
    retries[0]?.();
    await settle(() => sent.length === 2, 2000, "the retry asks the host again");
  });

  test("send goes to the open session, with images only when there are some", async () => {
    const { slice, sent } = commands();
    await slice.send("hi");
    await slice.send("see", [{ mediaType: "image/png", data: "AA==" }] as never);
    expect(sent[0]).toEqual({ type: "session.send", payload: { sessionId: "s1", text: "hi" } });
    expect(Object.keys(sent[1]?.payload ?? {})).toContain("images");
  });

  test("interrupt, close, resume, model and effort each ask the open session's host", async () => {
    const { slice, sent } = commands();
    await slice.interrupt();
    await slice.close();
    await slice.resume();
    await slice.setModel("opus");
    await slice.setEffort("high");
    expect(sent).toEqual([
      { type: "session.interrupt", payload: { sessionId: "s1" } },
      { type: "session.close", payload: { sessionId: "s1" } },
      { type: "session.resume", payload: { sessionId: "s1" } },
      { type: "session.setModel", payload: { sessionId: "s1", model: "opus" } },
      { type: "session.setEffort", payload: { sessionId: "s1", effort: "high" } },
    ]);
  });

  test("the mode is taken only when the host accepts it", async () => {
    const ok = commands();
    expect(await ok.slice.setMode("plan" as never)).toBe(true);
    const refused = commands({ refuse: "not now" });
    expect(await refused.slice.setMode("plan" as never)).toBe(false);
    expect(refused.failures.map((f) => f.message)).toEqual(["not now"]);
  });

  test("with no session open, or none chosen, nothing is sent", async () => {
    for (const selected of [null, { hostId: "h1", sessionId: null }]) {
      const { slice, sent, failures } = commands({ selected });
      await slice.interrupt();
      expect(await slice.setMode("plan" as never)).toBe(false);
      expect(sent).toEqual([]);
      expect(failures).toEqual([]);
    }
  });

  test("a refusal reaches the person and the call still resolves", async () => {
    const { slice, failures } = commands({ refuse: "gone" });
    await slice.send("hi");
    expect(failures).toEqual([{ message: "gone", retry: false }]);
  });

  test("an open session on a host with no connection sends nothing", async () => {
    const { slice, sent, failures } = commands({ connected: false });
    await slice.close();
    expect(sent).toEqual([]);
    expect(failures).toEqual([]);
  });
});
