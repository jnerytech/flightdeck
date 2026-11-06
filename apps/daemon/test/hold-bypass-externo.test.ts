import { afterEach, describe, expect, test } from "bun:test";
import type { PermissionUpdate } from "@flightdeck/protocol";
import type { Central } from "../src/central/central.ts";
import { ExternalSessions } from "../src/central/external.ts";
import { ExternalPermissions } from "../src/central/external-permissions.ts";
import { startReceptor } from "../src/central/receptor.ts";
import { SessionMetaStore } from "../src/central/session-meta.ts";
import { RiskClassifier } from "../src/permissions/risk.ts";
import { startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "bypass-token-0123456789abcdef";
const HOOKS = "bypass-hooks-0123456789";
const CWD = "/work/proj";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const risks = new RiskClassifier({ allowedRoots: [CWD], home: "/home/u" });

const rule = (toolName: string, ruleContent?: string): PermissionUpdate => ({
  type: "addRules",
  rules: [ruleContent === undefined ? { toolName } : { toolName, ruleContent }],
  behavior: "allow",
  destination: "localSettings",
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
