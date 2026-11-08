import { describe, expect, test } from "bun:test";
import {
  FINISHED_CAP,
  type Finish,
  finishOutcome,
  loadFinished,
  recordFinish,
  saveFinished,
  sinceLastLook,
  withFiles,
} from "../src/lib/finished.ts";

const finish = (sessionId: string, at: string, over: Partial<Finish> = {}): Finish => ({
  key: `h1/${sessionId}`,
  hostId: "h1",
  sessionId,
  name: sessionId,
  outcome: "done",
  at,
  files: null,
  ...over,
});

describe("finishOutcome", () => {
  test("a turn that ends idle is done, one that ends in an error is failed", () => {
    for (const before of ["starting", "running", "awaiting_permission"] as const) {
      expect(finishOutcome(before, "idle")).toBe("done");
      expect(finishOutcome(before, "error")).toBe("failed");
    }
  });

  test("a session that ends is ended, once", () => {
    expect(finishOutcome("running", "ended")).toBe("ended");
    expect(finishOutcome("idle", "ended")).toBe("ended");
    expect(finishOutcome("ended", "ended")).toBeNull();
  });

  test("a status frame that repeats, or the first sight of a session, is no finish", () => {
    expect(finishOutcome("idle", "idle")).toBeNull();
    expect(finishOutcome("running", "running")).toBeNull();
    expect(finishOutcome("error", "error")).toBeNull();
    expect(finishOutcome("idle", "running")).toBeNull();
    expect(finishOutcome(undefined, "idle")).toBeNull();
    expect(finishOutcome(undefined, "error")).toBeNull();
  });
});

describe("recordFinish", () => {
  test("keeps the newest first", () => {
    const list = recordFinish(
      recordFinish([], finish("a", "2026-11-08T10:00:00Z")),
      finish("b", "2026-11-08T11:00:00Z"),
    );
    expect(list.map((f) => f.sessionId)).toEqual(["b", "a"]);
  });

  test("a session that finishes again replaces its earlier finish", () => {
    const list = recordFinish(
      recordFinish([], finish("a", "2026-11-08T10:00:00Z", { outcome: "failed" })),
      finish("a", "2026-11-08T12:00:00Z"),
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.at).toBe("2026-11-08T12:00:00Z");
    expect(list[0]?.outcome).toBe("done");
  });

  test("keeps only the latest few", () => {
    let list: Finish[] = [];
    for (let i = 0; i < FINISHED_CAP + 5; i++) {
      list = recordFinish(
        list,
        finish(`s${i}`, new Date(Date.UTC(2026, 10, 8, 0, i)).toISOString()),
      );
    }
    expect(list).toHaveLength(FINISHED_CAP);
    expect(list[0]?.sessionId).toBe(`s${FINISHED_CAP + 4}`);
    expect(list.some((f) => f.sessionId === "s0")).toBe(false);
  });
});

describe("withFiles", () => {
  test("sets the count of that finish", () => {
    const list = [finish("a", "2026-11-08T10:00:00Z")];
    expect(withFiles(list, "h1/a", "2026-11-08T10:00:00Z", 3)[0]?.files).toBe(3);
  });

  test("leaves a later finish of the same session alone", () => {
    const list = [finish("a", "2026-11-08T12:00:00Z")];
    expect(withFiles(list, "h1/a", "2026-11-08T10:00:00Z", 3)[0]?.files).toBeNull();
  });
});

describe("sinceLastLook", () => {
  const list = [
    finish("c", "2026-11-08T12:00:00Z"),
    finish("b", "2026-11-08T11:00:00Z"),
    finish("a", "2026-11-08T10:00:00Z"),
  ];

  test("before any look, every finish is new", () => {
    expect(sinceLastLook(list, null).map((f) => f.sessionId)).toEqual(["c", "b", "a"]);
  });

  test("lists only what finished after the look, newest first", () => {
    expect(sinceLastLook(list, "2026-11-08T10:30:00Z").map((f) => f.sessionId)).toEqual(["c", "b"]);
  });

  test("a finish at the very moment of the look was seen", () => {
    expect(sinceLastLook(list, "2026-11-08T11:00:00Z").map((f) => f.sessionId)).toEqual(["c"]);
  });

  test("looking after the last finish leaves nothing", () => {
    expect(sinceLastLook(list, "2026-11-08T13:00:00Z")).toEqual([]);
  });
});

describe("loadFinished and saveFinished", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  };

  test("what was saved comes back", () => {
    const storage = memory();
    const state = {
      list: [finish("a", "2026-11-08T10:00:00Z", { files: 2, outcome: "failed" })],
      lastLook: "2026-11-08T09:00:00Z",
    };
    saveFinished(storage, state);
    expect(loadFinished(storage)).toEqual(state);
  });

  test("a stored list longer than the cap is cut to the newest", () => {
    const storage = memory();
    const list = Array.from({ length: FINISHED_CAP + 10 }, (_, i) =>
      finish(`s${i}`, new Date(Date.UTC(2026, 10, 8, 0, 0, i)).toISOString()),
    ).reverse();
    saveFinished(storage, { list, lastLook: null });
    const loaded = loadFinished(storage).list;
    expect(loaded).toHaveLength(FINISHED_CAP);
    expect(loaded[0]?.sessionId).toBe(`s${FINISHED_CAP + 9}`);
  });

  test("nothing saved, or text that is not the list, reads as empty", () => {
    expect(loadFinished(memory())).toEqual({ list: [], lastLook: null });
    const bad = memory();
    bad.setItem("flightdeck.finished", "{not json");
    expect(loadFinished(bad)).toEqual({ list: [], lastLook: null });
    bad.setItem("flightdeck.finished", JSON.stringify({ list: [{ key: 1 }], lastLook: 5 }));
    expect(loadFinished(bad)).toEqual({ list: [], lastLook: null });
  });
});
