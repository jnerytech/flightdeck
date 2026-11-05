import { afterEach, describe, expect, test } from "bun:test";
import { DAEMON_REASONS, FEATURE_HOLD_PROOF, type PermissionDecision } from "@flightdeck/protocol";
import type { Central } from "../src/central/central.ts";
import { ExternalSessions } from "../src/central/external.ts";
import { ExternalPermissions } from "../src/central/external-permissions.ts";
import { startReceptor } from "../src/central/receptor.ts";
import { SessionMetaStore } from "../src/central/session-meta.ts";
import { FlightdeckError } from "../src/errors.ts";
import { PermissionBroker } from "../src/permissions/permission-broker.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "app-token-0123456789abcdef";
const HOOKS = "hooks-token-0123456789";
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

/** A broker whose classifier calls the tool named "Danger" high and everything else low. */
function broker() {
  const store = new EventStore(":memory:");
  store.createSession({
    id: "s",
    name: null,
    cwd: "/",
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
    classify: (_id, tool) =>
      tool === "Danger"
        ? { level: "high", reason: "test", network: false }
        : { level: "low", reason: "test", network: false },
  });
  const ask = async (tool: string) => {
    const result: { value?: PermissionDecision } = {};
    const pending = b.request("s", tool, {}, new AbortController().signal).then((d) => {
      result.value = d;
    });
    await poll(() => requested.length > 0);
    return { id: requested[requested.length - 1] ?? "", result, pending };
  };
  return { b, ask };
}

describe("prova-de-espera: the daemon asks for the hold of a high-risk allow (issue #251)", () => {
  test("a high-risk allow without the hold is refused with its reason and the request stays open", async () => {
    const { b, ask } = broker();
    const { id, result, pending } = await ask("Danger");
    expect(refusal(() => b.respond({ requestId: id, decision: "allow" }))).toEqual({
      code: "invalid_state",
      reason: "hold_required",
    });
    expect(result.value).toBeUndefined();
    b.respond({ requestId: id, decision: "allow", held: true });
    await pending;
    expect(result.value?.behavior).toBe("allow");
  });

  test("a deny never needs the hold, and neither does an allow of a low-risk request", async () => {
    const { b, ask } = broker();
    const denied = await ask("Danger");
    expect(refusal(() => b.respond({ requestId: denied.id, decision: "deny" }))).toBeNull();
    await denied.pending;
    expect(denied.result.value?.behavior).toBe("deny");
    const low = await ask("Write");
    expect(refusal(() => b.respond({ requestId: low.id, decision: "allow" }))).toBeNull();
    await low.pending;
    expect(low.result.value?.behavior).toBe("allow");
  });

  test("held: false is not a hold", async () => {
    const { b, ask } = broker();
    const { id } = await ask("Danger");
    expect(refusal(() => b.respond({ requestId: id, decision: "allow", held: false }))).toEqual({
      code: "invalid_state",
      reason: "hold_required",
    });
  });

  test("the refusal has a reason the app can word, and the host announces the check", () => {
    expect(DAEMON_REASONS).toContain("hold_required");
    expect(FEATURE_HOLD_PROOF).toBe("hold-proof");
  });
});

describe("prova-de-espera: external requests carry the risk the daemon judged, so they need the hold too", () => {
  function setup() {
    const { manager, store } = newManager();
    const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
    const permissions = new ExternalPermissions();
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

  test("an allow of a held `rm -rf` hook is refused over the wire without the hold, and goes through with it", async () => {
    const { receptor, server } = setup();
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    await client.request("external.watch", {});
    await post(receptor.url, "SessionStart", { cwd: "/p" });
    const answer = post(receptor.url, "PermissionRequest", {
      tool_name: "Bash",
      tool_input: { command: "rm -rf build" },
      permission_suggestions: [],
    });
    const open = await poll(() =>
      client.frames.find(
        (f) => f.type === "external.permission" && (f as { state?: string }).state === "open",
      ),
    );
    const requestId = (open as { requestId: string }).requestId;
    expect((open as { risk: string }).risk).toBe("high");
    const refused = await client.request("permission.respond", { requestId, decision: "allow" });
    expect(refused).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(JSON.stringify(refused)).toContain("hold_required");
    const ok = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      held: true,
    });
    expect(ok.ok).toBe(true);
    expect(JSON.parse(await answer).hookSpecificOutput.decision.behavior).toBe("allow");
  });

  test("host.info announces hold-proof", async () => {
    const { server } = setup();
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features).toContain(FEATURE_HOLD_PROOF);
  });
});
