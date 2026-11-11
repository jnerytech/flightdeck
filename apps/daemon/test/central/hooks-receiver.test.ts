import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { Central } from "../../src/central/central.ts";
import { ExternalSessions, type ExternalStatus } from "../../src/central/external.ts";
import { ProjectKeys } from "../../src/central/project-key.ts";
import { type Receptor, startReceptor } from "../../src/central/receptor.ts";
import { ClaudeSdkRuntime, type QueryFn } from "../../src/runtime/claude-sdk-runtime.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { newManager, tempDir } from "../support/helpers.ts";

const TOKEN = "hooks-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function setup() {
  const store = new EventStore(":memory:");
  const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
  const managed = new Set(["gerenciada"]);
  const receptor = startReceptor({
    port: 0,
    token: () => TOKEN,
    external,
    isManaged: (id) => managed.has(id),
  });
  cleanups.push(() => receptor.stop());
  return { external, receptor };
}

async function post(
  receptor: Receptor,
  event: string,
  body: unknown,
  token: string | null = TOKEN,
) {
  const response = await fetch(`${receptor.url}/hooks/${event}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.text() };
}

/** A non-loopback IPv4 of this machine, if it has one. */
const lanAddress = () =>
  Object.values(networkInterfaces())
    .flat()
    .find((info) => info?.family === "IPv4" && !info.internal)?.address;

describe("hooks-receptor", () => {
  test("escuta só em 127.0.0.1, na porta pedida (0 nos testes)", async () => {
    const { receptor } = setup();
    expect(receptor.port).toBeGreaterThan(0);
    expect(receptor.url).toBe(`http://127.0.0.1:${receptor.port}`);
    expect((await fetch(`${receptor.url}/health`)).status).toBe(200);
    const lan = lanAddress();
    if (lan) {
      const reached = await fetch(`http://${lan}:${receptor.port}/health`).then(
        () => "respondeu",
        () => "recusou",
      );
      expect(reached).toBe("recusou");
    }
  });

  test("token errado ou ausente dá 401 e nada muda", async () => {
    const { receptor, external } = setup();
    const start = { session_id: "s1", cwd: "/p", hook_event_name: "SessionStart" };
    expect((await post(receptor, "SessionStart", start, "errado")).status).toBe(401);
    expect((await post(receptor, "SessionStart", start, null)).status).toBe(401);
    expect(external.list()).toEqual([]);
    expect((await fetch(`${receptor.url}/outra-rota`, { method: "POST" })).status).toBe(404);
  });

  test("cada evento da tabela muda o estado da sessão externa, com resposta vazia", async () => {
    const { receptor, external } = setup();
    const steps: Array<[string, Record<string, unknown>, ExternalStatus]> = [
      ["SessionStart", { cwd: "/p", transcript_path: "/p/s1.jsonl", source: "startup" }, "idle"],
      ["UserPromptSubmit", { prompt: "oi" }, "running"],
      ["PermissionRequest", { tool_name: "Write", tool_input: {} }, "awaiting_permission"],
      ["PostToolUse", { tool_name: "Write" }, "running"],
      ["Notification", { notification_type: "permission_prompt" }, "awaiting_permission"],
      ["PermissionDenied", { tool_name: "Bash" }, "running"],
      ["PostToolUseFailure", { tool_name: "Bash" }, "running"],
      ["Stop", {}, "idle"],
      ["SessionEnd", { reason: "exit" }, "ended"],
    ];
    for (const [event, payload, status] of steps) {
      const answer = await post(receptor, event, {
        session_id: "s1",
        hook_event_name: event,
        ...payload,
      });
      expect(answer).toEqual({ status: 200, body: "" });
      expect(external.get("s1")?.status).toBe(status);
    }
    expect(external.get("s1")?.cwd).toBe("/p");
  });

  test("corpo que não é JSON é recusado com 400", async () => {
    const { receptor } = setup();
    const response = await fetch(`${receptor.url}/hooks/Stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: "{",
    });
    expect(response.status).toBe(400);
  });

  test("hooks de sessões gerenciadas pelo daemon são ignorados", async () => {
    const { receptor, external } = setup();
    // Known by its claudeSessionId…
    expect(await post(receptor, "UserPromptSubmit", { session_id: "gerenciada" })).toEqual({
      status: 200,
      body: "",
    });
    // …or flagged by the SessionStart command (FLIGHTDECK_MANAGED=1), before session.init.
    await post(receptor, "SessionStart", { session_id: "nova", cwd: "/p", managed: true });
    await post(receptor, "UserPromptSubmit", { session_id: "nova" });
    expect(external.list()).toEqual([]);
  });

  test("o runtime do Claude marca as sessões gerenciadas com FLIGHTDECK_MANAGED=1", () => {
    let options: Options | undefined;
    const query: QueryFn = (params) => {
      options = params.options;
      return {
        async *[Symbol.asyncIterator]() {},
        interrupt: async () => {},
        close: () => {},
      };
    };
    const runtime = new ClaudeSdkRuntime({ query, claudePath: "/bin/claude" });
    runtime.start({
      cwd: "/proj",
      permissionMode: "default",
      env: { PATH: "/bin" },
      canUseTool: async () => ({ behavior: "allow" }),
    });
    expect(options?.env).toEqual({ PATH: "/bin", FLIGHTDECK_MANAGED: "1" });
  });
});

const CENTRAL_TOKEN = "central-token-0123456789abcdef";

/** A Central over a fresh manager; the receptor asks for `token` when one is given. */
function newCentral(dir: string, options: { token?: string; dataDir?: string } = {}) {
  const configFile = join(dir, "config.json");
  writeFileSync(configFile, "{}");
  const { manager, store, project } = newManager();
  const central = new Central({
    db: store.db,
    keys: new ProjectKeys("h", async () => ({ code: 1, stdout: "" })),
    manager,
    hooks: {
      port: 0,
      ...(options.token ? { token: options.token } : {}),
      permissionTimeoutS: 600,
      staleAfterS: 900,
    },
    dataDir: options.dataDir ?? join(dir, "data"),
    hostName: "h",
    configFile,
    selfCommand: ["flightdeckd"],
    settingsPath: () => join(dir, "settings.json"),
  });
  return { central, manager, project };
}

describe("hooks-receptor: through the Central", () => {
  test("a hook from a session the host does not run is checked against the sessions it does", async () => {
    const dir = tempDir("fd-central-hook-");
    const { central, manager, project } = newCentral(dir, { token: CENTRAL_TOKEN });
    cleanups.push(() => central.stop());
    await manager.create({ cwd: project, prompt: "hi" });
    const response = await fetch(`${central.receptorUrl()}/hooks/Stop`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${CENTRAL_TOKEN}`,
      },
      body: JSON.stringify({ session_id: "not-managed-here" }),
    });
    expect(response.status).toBe(200);
    expect(central.external.get("not-managed-here")).toBeDefined();
  });

  test("a receptor file that cannot be written does not crash the daemon, and stopping settles", async () => {
    const dir = tempDir("fd-central-file-");
    const notAFolder = join(dir, "data");
    writeFileSync(notAFolder, "a file where the data folder should be");
    const { central } = newCentral(dir, { token: CENTRAL_TOKEN, dataDir: notAFolder });
    await expect(central.ready()).rejects.toThrow();
    // Stopping waits for the failed write and settles (cleaning up under a file may complain).
    expect(["stopped", "refused"]).toContain(
      await central.stop().then(
        () => "stopped",
        () => "refused",
      ),
    );
  });
});
