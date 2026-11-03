import { describe, expect, test } from "bun:test";
import type { PersonaAgent } from "@flightdeck/protocol";
import type { PreparedPersonas } from "../src/personas/prepare.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, waitFor } from "./helpers.ts";

const AGENT: PersonaAgent = { description: "Reviews", prompt: "Look for leaks." };

const prepared = (): PreparedPersonas =>
  ({
    persona: {
      persona: {
        id: "seg",
        name: "Security",
        icon: null,
        description: "",
        model: null,
        effort: null,
        tools: null,
        permissionMode: null,
        body: "Look for leaks.",
      },
      source: "host",
      hash: null,
    },
    agents: { "persona-seg": AGENT },
  }) as never;

describe("sessoes-sem-leitura: the session manager reads no persona file", () => {
  test("create takes the resolved persona and the subagents, and the run opens with them", async () => {
    const { manager, runtime, project } = newManager();
    const { sessionId } = manager.create(
      { cwd: project, prompt: "hi", persona: { id: "seg" } },
      { prepared: prepared() },
    );
    await waitFor(() => runtime.starts.length > 0);
    expect(runtime.starts[0]?.agents).toEqual({ "persona-seg": AGENT });
    expect(manager.get(sessionId).persona?.id).toBe("seg");
  });

  test("a session reattached after a restart keeps the subagents it opened with", async () => {
    const store = new EventStore(":memory:");
    const first = newManager({ store });
    const { sessionId } = first.manager.create(
      { cwd: first.project, prompt: "hi" },
      { prepared: { persona: null, agents: { "persona-seg": AGENT } } },
    );
    await waitFor(() => first.runtime.starts.length > 0);
    // A new manager over the same store: nothing live, nothing prepared for this send.
    store.updateSession(sessionId, { status: "idle" });
    const second = newManager({ store });
    second.manager.send(sessionId, "again");
    await waitFor(() => second.runtime.starts.length > 0);
    expect(second.runtime.starts[0]?.agents).toEqual({ "persona-seg": AGENT });
  });

  test("a persona asked for but not prepared is refused, with a reason", async () => {
    const { manager, project } = newManager();
    let reason: string | undefined;
    try {
      manager.create({ cwd: project, prompt: "hi", persona: { id: "seg" } });
    } catch (error) {
      reason = (error as { reason?: string }).reason;
    }
    expect(reason).toBe("personas_off");
  });
});
