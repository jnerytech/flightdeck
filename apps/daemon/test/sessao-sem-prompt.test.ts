import { describe, expect, test } from "bun:test";
import { Command } from "@flightdeck/protocol";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { newManager, poll } from "./helpers.ts";

describe("sessao-sem-prompt: a session can start with no first prompt", () => {
  test("the protocol accepts session.create with no prompt, and still refuses an empty one", () => {
    const base = { id: "1", type: "session.create" };
    expect(Command.safeParse({ ...base, payload: { cwd: "/p" } }).success).toBe(true);
    expect(Command.safeParse({ ...base, payload: { cwd: "/p", prompt: "" } }).success).toBe(false);
  });

  test("it is created idle, sends nothing, and the first message starts the first turn", async () => {
    const runtime = new FakeRuntime({ delayMs: 1 });
    const { manager, store, project } = newManager({ runtime });
    const { sessionId } = manager.create({ cwd: project });
    expect(manager.get(sessionId).status).toBe("idle");
    await Bun.sleep(30);
    const said = () =>
      store
        .eventsSince(sessionId)
        .map((e) => e.event)
        .flatMap((e) => (e.type === "message.user" ? [e.text] : []));
    expect(said()).toEqual([]);
    expect(manager.get(sessionId).status).toBe("idle");
    manager.send(sessionId, "hello");
    await poll(() => said().length === 1, 3000);
    expect(said()).toEqual(["hello"]);
    await poll(() => manager.get(sessionId).status === "idle", 3000);
  });
});
