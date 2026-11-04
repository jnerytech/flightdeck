import { describe, expect, test } from "bun:test";
import { memoryPlatform } from "./fixtures.ts";

const { AppStore } = await import("../src/lib/app-store.ts");

const session = (status: string, lastEventAt: string, state: string) => ({
  claudeSessionId: "ext-2",
  cwd: "/work/app-b",
  transcriptPath: null,
  source: null,
  status,
  statusReason: null,
  launchId: null,
  controllable: false,
  projectKey: null,
  startedAt: "2026-11-04T03:00:00.000Z",
  lastEventAt,
  endedAt: null,
  summary: { request: "apague", state, tool: null, since: lastEventAt },
});

describe("externos-lista-velha: a list answered late does not undo a newer frame", () => {
  test("an external.list read before a hook but answered after its frame leaves the newer session", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    const running = session("running", "2026-11-04T03:30:00.000Z", "running");
    const waiting = session("awaiting_permission", "2026-11-04T03:30:05.000Z", "waiting");
    let answerList: () => void = () => {};
    const listAnswered = new Promise<void>((resolve) => {
      answerList = resolve;
    });
    const internals = store as unknown as {
      state: { hosts: unknown[] };
      connections: Map<string, unknown>;
      onExternal(hostId: string, frame: unknown): void;
    };
    internals.state.hosts = [
      {
        id: "h",
        name: "alfa",
        status: "online",
        hostInfo: { features: [] },
        sessions: [],
        attempt: 0,
      },
    ];
    internals.connections.set("h", {
      request: async (type: string) => {
        if (type === "external.list") {
          // The host read its list before the hook; the answer travels slowly.
          await listAnswered;
          return { sessions: [running] };
        }
        if (type === "session.list" || type === "history.list") return { sessions: [] };
        return null;
      },
    });
    const refreshing = store.refreshHub();
    // Meanwhile the hook happened and its frame arrived.
    internals.onExternal("h", { type: "external.updated", session: waiting });
    answerList();
    await refreshing;
    expect(store.getState().externals["h/ext-2"]?.summary?.state).toBe("waiting");
  });
});
