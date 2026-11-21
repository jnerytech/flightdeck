import { describe, expect, test } from "bun:test";
import type { SessionEvent } from "@flightdeck/protocol";
import { ExternalPermissions } from "../../src/central/external-permissions.ts";
import { PermissionBroker } from "../../src/permissions/permission-broker.ts";
import { EventStore } from "../../src/store/event-store.ts";

/** Lets the promises already started finish: no timer, no clock. */
const flush = () => new Promise<void>((done) => setImmediate(done));

const RISK = {
  level: "high",
  reason: "saves, trusts or removes an action",
  network: false,
} as const;

/** A broker that asks a person (no automatic answer), with the given extra sentence about the request. */
function setup(
  explain?: (
    sessionId: string,
    tool: string,
    input: Record<string, unknown>,
  ) => Promise<string> | undefined,
) {
  const store = new EventStore(":memory:");
  store.createSession({
    id: "s",
    name: null,
    cwd: "/",
    status: "running",
    permissionMode: "default",
    model: null,
  });
  const events: SessionEvent[] = [];
  const broker = new PermissionBroker(store, {
    emit: (_id, event) => events.push(event),
    onPendingChange: () => {},
    classify: () => ({ ...RISK }),
    ...(explain ? { explain } : {}),
  });
  const asked = (): Array<Record<string, unknown>> =>
    events.filter((e) => e.type === "permission.requested") as unknown as Array<
      Record<string, unknown>
    >;
  return { broker, asked };
}

describe("a request that carries an extra sentence about itself (#3752)", () => {
  test("the sentence follows the rule's reason in riskReason, and the level stays high", async () => {
    const { broker, asked } = setup(async () => 'saves d.json: run ["deploy.sh"]');
    void broker.request(
      "s",
      "Bash",
      { command: "fd action save --definition-file d.json" },
      new AbortController().signal,
    );
    await flush();
    expect(asked().map((e) => [e.risk, e.riskReason])).toEqual([
      ["high", 'saves, trusts or removes an action. saves d.json: run ["deploy.sh"]'],
    ]);
  });

  test("the summary lists the same reason the request was announced with", async () => {
    const { broker, asked } = setup(async () => "saves d.json");
    void broker.request("s", "Bash", { command: "x" }, new AbortController().signal);
    await flush();
    const id = asked()[0]?.requestId as string;
    expect(broker.reasonOf(id)).toBe("saves, trusts or removes an action. saves d.json");
  });

  test("a request the hook has nothing to say about keeps the rule's reason", async () => {
    const { broker, asked } = setup(() => undefined);
    void broker.request("s", "Bash", { command: "ls" }, new AbortController().signal);
    await flush();
    expect(asked().map((e) => e.riskReason)).toEqual(["saves, trusts or removes an action"]);
    expect(broker.reasonOf(asked()[0]?.requestId as string)).toBeUndefined();
  });

  test("a hook that fails does not stop the request: it is announced with the rule's reason", async () => {
    const { broker, asked } = setup(() => Promise.reject(new Error("no file")));
    void broker.request("s", "Bash", { command: "x" }, new AbortController().signal);
    await flush();
    expect(asked().map((e) => e.riskReason)).toEqual(["saves, trusts or removes an action"]);
  });
});

describe("a hook that throws before it returns a promise (#3752)", () => {
  const boom = (): Promise<string> => {
    throw new Error("no session");
  };

  test("the request is still announced with the rule's reason", async () => {
    const { broker, asked } = setup(boom);
    broker.request("s", "Bash", { command: "x" }, new AbortController().signal).catch(() => {});
    await flush();
    expect(asked().map((e) => e.riskReason)).toEqual(["saves, trusts or removes an action"]);
  });

  test("an external request is still held", async () => {
    const permissions = new ExternalPermissions({ explain: boom });
    const states: unknown[] = [];
    permissions.watch((frame) => states.push((frame as unknown as { state: unknown }).state));
    permissions
      .hold(
        {
          session_id: "s1",
          cwd: "/p",
          tool_name: "Bash",
          tool_input: { command: "fd action save --definition-file d.json" },
        } as never,
        new AbortController().signal,
      )
      .catch(() => {});
    await flush();
    expect(states).toEqual(["open"]);
  });
});

describe("an external session's request carries the same sentence (#3752)", () => {
  function held(explain?: (command: string, cwd: string) => Promise<string> | undefined) {
    const permissions = new ExternalPermissions(explain ? { explain } : {});
    const frames: Array<Record<string, unknown>> = [];
    permissions.watch((frame) => frames.push(frame as unknown as Record<string, unknown>));
    const hold = (command: string, signal = new AbortController().signal) =>
      permissions.hold(
        { session_id: "s1", cwd: "/p", tool_name: "Bash", tool_input: { command } } as never,
        signal,
      );
    return { frames, hold };
  }

  test("the open frame's riskReason says what the file saves, and the level is high", async () => {
    const { frames, hold } = held(
      async (command, cwd) => `saves d.json in ${cwd} for ${command.length}`,
    );
    void hold("fd action save --definition-file d.json");
    await flush();
    expect(frames.map((f) => [f.state, f.risk, f.riskReason])).toEqual([
      [
        "open",
        "high",
        "saves, trusts or removes an action: a saved action is trusted as it is saved and then runs with its secrets, and a trusted one may run, without the person choosing it in the app (flightdeckd action save, trust or remove). saves d.json in /p for 39",
      ],
    ]);
  });

  test("a command with nothing to explain is held with the rule's reason alone", async () => {
    const { frames, hold } = held(() => undefined);
    void hold("fd action trust deploy --hash abc");
    await flush();
    expect(
      String(frames[0]?.riskReason).endsWith("(flightdeckd action save, trust or remove)"),
    ).toBe(true);
  });

  test("a hook that fails still holds the request", async () => {
    const { frames, hold } = held(() => Promise.reject(new Error("no file")));
    void hold("fd action save --definition-file d.json");
    await flush();
    expect(frames.map((f) => f.state)).toEqual(["open"]);
  });

  test("a hook that was aborted while the file was read leaves nothing held", async () => {
    const abort = new AbortController();
    const { frames, hold } = held(async () => "saves d.json");
    const answer = hold("fd action save --definition-file d.json", abort.signal);
    abort.abort();
    expect(await answer).toBe("");
    expect(frames).toEqual([]);
  });
});
