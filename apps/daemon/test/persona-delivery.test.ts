import { describe, expect, test } from "bun:test";
import { OpenSessionPersonas } from "../src/personas/open-session.ts";

/** A switcher over fakes: the manager answers `queued` as told, the terminal has a channel. */
function switcher(options: { queued: boolean; channel?: boolean }) {
  const persona = { id: "seg", name: "Reviewer", icon: null };
  const applied = new Map<string, typeof persona>();
  const sent: string[] = [];
  const external = {
    get: (id: string) => (id === "t-1" ? { cwd: "/p", launchId: "L1" } : undefined),
    appliedPersona: (id: string) => applied.get(id) ?? null,
    setPersona: (id: string, badge: typeof persona | null) => {
      if (badge) applied.set(id, badge);
      else applied.delete(id);
    },
  };
  return new OpenSessionPersonas({
    personas: {
      resolve: () => ({ persona: { ...persona, body: "Look for leaks." } }) as never,
    },
    manager: {
      get: () => ({ cwd: "/p" }) as never,
      send: (_id: string, text: string) => {
        sent.push(text);
        return { queued: options.queued };
      },
      appliedPersona: (id: string) => applied.get(id) ?? null,
      markPersona: (id: string, badge: typeof persona | null) => {
        if (badge) applied.set(id, badge);
        else applied.delete(id);
      },
    },
    central: {
      external,
      receptor: { sendToLaunch: () => options.channel !== false },
    } as never,
  });
}

describe("persona-delivery", () => {
  test("an idle managed session gets the instruction at once: sent", async () => {
    const s = switcher({ queued: false });
    expect((await s.apply({ sessionId: "m-1", persona: { id: "seg" } })).delivery).toBe("sent");
    expect((await s.clear({ sessionId: "m-1" })).delivery).toBe("sent");
  });

  test("a managed session in a turn or waiting for a permission queues it: queued", async () => {
    const s = switcher({ queued: true });
    expect((await s.apply({ sessionId: "m-1", persona: { id: "seg" } })).delivery).toBe("queued");
    expect((await s.clear({ sessionId: "m-1" })).delivery).toBe("queued");
  });

  test("a terminal session gets it on its channel: terminal, since it shows when Claude takes it", async () => {
    const s = switcher({ queued: false });
    expect((await s.apply({ claudeSessionId: "t-1", persona: { id: "seg" } })).delivery).toBe(
      "terminal",
    );
    expect((await s.clear({ claudeSessionId: "t-1" })).delivery).toBe("terminal");
  });
});
