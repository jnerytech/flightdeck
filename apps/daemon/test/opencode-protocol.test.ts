import { afterEach, describe, expect, test } from "bun:test";
import * as protocol from "@flightdeck/protocol";
import type { OpenCodeInfo } from "../src/runtime/opencode-discovery.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";

const TOKEN = "opencode-protocol-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function ask(server: RunningServer, type: string, payload: object) {
  const ws = new WebSocket(server.url);
  const acks: protocol.Ack[] = [];
  ws.addEventListener("message", (m) => {
    const msg = protocol.parseServerMessage(String(m.data));
    if (msg.type === "ack") acks.push(msg);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
  ws.send(JSON.stringify({ id: "2", type, payload }));
  const ack = await poll(() => acks.find((a) => a.id === "2"), 10_000);
  ws.close();
  return ack;
}

function host(info: OpenCodeInfo | null) {
  const ctx = newManager();
  const server = startServer({
    manager: ctx.manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
    ...(info
      ? {
          opencode: {
            info: () => info,
            models: async () => [
              { id: "anthropic/claude-sonnet-5-5", name: "anthropic/claude-sonnet-5-5" },
              { id: "opencode/crouton-alpha-free", name: "opencode/crouton-alpha-free" },
            ],
          },
        }
      : {}),
  });
  cleanups.push(() => server.stop());
  return server;
}

const NEW_REASONS = [
  "runtime_unavailable",
  "runtime_unsupported",
  "opencode_unsafe_global",
  "opencode_config_outranks",
  "opencode_saved_rules",
  "opencode_preflight_failed",
  "opencode_changed",
  "opencode_permissions_overridden",
  "opencode_auth_required",
  "opencode_disabled",
  "opencode_missing",
  "opencode_version_failed",
  "opencode_v1",
  "opencode_project_config_not_disabled",
  "opencode_canary_failed",
  "opencode_scope_mismatch",
];

describe("opencode-protocol", () => {
  test("host.info lists OpenCode with its version and announces the feature when it is available", async () => {
    const server = host({
      available: true,
      path: "/bin/opencode",
      version: "2.2.5",
      verified: true,
    });
    const ack = await ask(server, "host.info", {});
    const data = (ack?.ok ? ack.data : null) as protocol.HostInfoResult | null;
    expect(data?.runtimes).toEqual([
      {
        kind: "opencode",
        available: true,
        path: "/bin/opencode",
        version: "2.2.5",
        verified: true,
      },
    ]);
    expect(data?.features ?? []).toContain("opencode");
  });

  test("an unavailable OpenCode is listed with its reason and no feature; a host without it lists none", async () => {
    const off = host({ available: false, reason: "opencode_missing" });
    const data = (await ask(off, "host.info", {}))?.ok
      ? ((await ask(off, "host.info", {})) as { data: protocol.HostInfoResult }).data
      : null;
    expect(data?.runtimes).toEqual([
      { kind: "opencode", available: false, reason: "opencode_missing" },
    ]);
    expect(data?.features ?? []).not.toContain("opencode");
    const none = await ask(host(null), "host.info", {});
    expect(none?.ok ? (none.data as protocol.HostInfoResult).runtimes : "no ack").toBe(undefined);
  });

  test("runtime.models answers OpenCode's models, and refuses with runtime_unavailable when it is not there", async () => {
    const ack = await ask(
      host({ available: true, path: "/bin/opencode", version: "2.2.5", verified: true }),
      "runtime.models",
      { runtime: "opencode" },
    );
    expect(ack?.ok ? ack.data : ack).toEqual({
      models: [
        { id: "anthropic/claude-sonnet-5-5", name: "anthropic/claude-sonnet-5-5" },
        { id: "opencode/crouton-alpha-free", name: "opencode/crouton-alpha-free" },
      ],
    });
    const refused = await ask(
      host({ available: false, reason: "opencode_missing" }),
      "runtime.models",
      { runtime: "opencode" },
    );
    expect(refused && !refused.ok ? refused.error.reason : "accepted").toBe("runtime_unavailable");
    const none = await ask(host(null), "runtime.models", { runtime: "opencode" });
    expect(none && !none.ok ? none.error.reason : "accepted").toBe("runtime_unavailable");
  });

  test("the payloads carry the runtime, and every new reason is one the app translates", () => {
    expect(protocol.SessionCreatePayload.parse({ cwd: "/w", runtime: "opencode" }).runtime).toBe(
      "opencode",
    );
    for (const reason of NEW_REASONS)
      expect(protocol.DAEMON_REASONS as readonly string[]).toContain(reason);
  });
});
