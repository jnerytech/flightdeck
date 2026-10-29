import { afterEach, describe, expect, test } from "bun:test";
import type { Central } from "../src/central/central.ts";
import { ExternalSessions } from "../src/central/external.ts";
import { ExternalPermissions } from "../src/central/external-permissions.ts";
import { type Receptor, startReceptor } from "../src/central/receptor.ts";
import { SessionMetaStore } from "../src/central/session-meta.ts";
import { startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "app-token-0123456789abcdef";
const HOOKS = "hooks-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A receptor holding PermissionRequest for an app connected to the protocol. */
async function setup() {
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
    central: { external, permissions, meta: new SessionMetaStore(store.db) } as unknown as Central,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  expect((await client.request("external.watch", {})).ok).toBe(true);
  return { permissions, receptor, client };
}

/** The PoC's mkdir: session suggestions only, plus one this daemon does not know. */
const SUGGESTIONS = [
  { type: "addDirectories", directories: ["/repo/novo"], destination: "session" },
  { type: "setMode", mode: "acceptEdits", destination: "session" },
  { type: "futuro", destination: "session" },
];

function ask(receptor: Receptor) {
  return (
    fetch(`${receptor.url}/hooks/PermissionRequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${HOOKS}`, "content-type": "application/json" },
      body: JSON.stringify({
        session_id: "s1",
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: { command: "mkdir novo" },
        permission_suggestions: SUGGESTIONS,
      }),
    })
      .then((r) => r.text())
      // A hook still held when its test ends has its connection dropped by the cleanup.
      .catch(() => "")
  );
}

const openFrame = (client: FrameClient) =>
  poll(
    () => client.frames.find((f) => f.type === "external.permission" && f.state === "open"),
    3000,
  );

describe("permitir-externo", () => {
  test("permission_suggestions chegam no external.permission, só as que o daemon entende", async () => {
    const { receptor, client } = await setup();
    void ask(receptor);
    const frame = await openFrame(client);
    expect(frame?.suggestions).toEqual(SUGGESTIONS.slice(0, 2));
  });

  test("a decisão do hook leva updatedPermissions: uma sugestão ou uma regra do projeto", async () => {
    const { receptor, client } = await setup();
    const answer = ask(receptor);
    const frame = await openFrame(client);
    const rule = {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }],
      behavior: "allow",
      destination: "localSettings",
    };
    const ack = await client.request("permission.respond", {
      requestId: frame?.requestId,
      decision: "allow",
      updatedPermissions: [SUGGESTIONS[0], rule],
    });
    expect(ack.ok).toBe(true);
    expect(JSON.parse(await answer)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow", updatedPermissions: [SUGGESTIONS[0], rule] },
      },
    });
  });

  test("updatedPermissions inválido dá invalid_permission_update e o hook segue segurado", async () => {
    const { receptor, client, permissions } = await setup();
    const answer = ask(receptor);
    const frame = await openFrame(client);
    for (const update of [
      { type: "setMode", mode: "bypassPermissions", destination: "session" },
      {
        type: "addRules",
        rules: [{ toolName: "Write" }],
        behavior: "allow",
        destination: "localSettings",
      },
      { type: "addDirectories", directories: ["/repo/novo"], destination: "userSettings" },
    ]) {
      const ack = await client.request("permission.respond", {
        requestId: frame?.requestId,
        decision: "allow",
        updatedPermissions: [update],
      });
      expect(ack).toMatchObject({ ok: false, error: { code: "invalid_permission_update" } });
      expect(permissions.open()).toHaveLength(1);
    }
    expect(
      (
        await client.request("permission.respond", {
          requestId: frame?.requestId,
          decision: "allow",
        })
      ).ok,
    ).toBe(true);
    expect(JSON.parse(await answer).hookSpecificOutput.decision).toEqual({ behavior: "allow" });
  });

  test("sem sugestões no pedido, o frame vem sem elas", async () => {
    const permissions = new ExternalPermissions();
    const frames: unknown[] = [];
    permissions.watch((frame) => frames.push(frame));
    void permissions.hold(
      { session_id: "s", tool_name: "Write", tool_input: {} },
      new AbortController().signal,
    );
    expect(frames[0]).not.toHaveProperty("suggestions");
  });
});
