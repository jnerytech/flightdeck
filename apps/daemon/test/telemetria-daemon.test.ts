import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { startDaemon } from "../src/main.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { jsonLogs } from "./otlp-helpers.ts";

const TOKEN = "daemon-token-0123456789abcdef0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function boot(extra: Record<string, unknown>) {
  const dir = tempDir();
  const file = join(dir, "config.json");
  const dataDir = join(dir, "data");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir,
      allowedRoots: [],
      hooks: { port: 0, token: "hooks-token-0123456789" },
      ...extra,
    }),
  );
  const logs: string[] = [];
  const errors: string[] = [];
  const daemon = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: (m) => logs.push(m), error: (m) => errors.push(m) },
  );
  cleanups.push(() => daemon.stop());
  return { daemon, dataDir, file, logs, errors };
}

const published = (dataDir: string) =>
  existsSync(join(dataDir, "telemetry.json"))
    ? (JSON.parse(readFileSync(join(dataDir, "telemetry.json"), "utf8")) as { url: string })
    : null;

describe("telemetria-dados: the daemon", () => {
  test("it listens, stores what the exporter sends, and stops listening with the daemon", async () => {
    const { daemon, dataDir, file } = await boot({ telemetry: { port: 0 } });
    const url = published(dataDir)?.url ?? "";
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const token = loadConfig(file).telemetry.token ?? "";
    const res = await fetch(`${url}/v1/logs`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: jsonLogs([
        {
          name: "tool_result",
          timeMs: Date.now(),
          attrs: {
            "session.id": "s-1",
            "prompt.id": "p-1",
            tool_name: "Bash",
            duration_ms: 12,
            tool_use_id: "t1",
          },
        },
      ]),
    });
    expect(res.status).toBe(200);
    const db = new Database(join(dataDir, "flightdeck.db"), { readonly: true });
    cleanups.push(() => db.close());
    expect(
      db
        .query("SELECT claude_session_id, prompt_id, tool_name, duration_ms FROM telemetry_events")
        .all(),
    ).toEqual([{ claude_session_id: "s-1", prompt_id: "p-1", tool_name: "Bash", duration_ms: 12 }]);
    // The app reads it back over the protocol, and the host announces it.
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect((await client.data<{ features: string[] }>("host.info", {}))?.features).toContain(
      "telemetry",
    );
    const timeline = await client.data<{ prompts: Array<{ promptId: string }> }>(
      "telemetry.session",
      { claudeSessionId: "s-1" },
    );
    expect(timeline?.prompts.map((p) => p.promptId)).toEqual(["p-1"]);
    await daemon.stop();
    expect(published(dataDir)).toBeNull();
  });

  test("the retention purge deletes what is older than telemetry.retentionDays when the daemon starts", async () => {
    const first = await boot({ telemetry: { port: 0, retentionDays: 1 } });
    const url = published(first.dataDir)?.url ?? "";
    const token = loadConfig(first.file).telemetry.token ?? "";
    const send = (timeMs: number, id: string) =>
      fetch(`${url}/v1/logs`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: jsonLogs([
          { name: "tool_result", timeMs, attrs: { "session.id": "s", tool_use_id: id } },
        ]),
      });
    await send(Date.now() - 3 * 86_400_000, "old");
    await send(Date.now(), "new");
    await first.daemon.stop();
    const again = await startDaemon(
      { command: "start", config: first.file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => again.stop());
    const db = new Database(join(first.dataDir, "flightdeck.db"), { readonly: true });
    cleanups.push(() => db.close());
    expect(db.query("SELECT ref FROM telemetry_events").all()).toEqual([{ ref: "new" }]);
  });

  test("off, or without the hooks token: no receiver, no file", async () => {
    const off = await boot({ telemetry: { enabled: false, port: 0 } });
    expect(published(off.dataDir)).toBeNull();
    const noHooks = await boot({ hooks: { port: 0 }, telemetry: { port: 0 } });
    expect(published(noHooks.dataDir)).toBeNull();
  });

  test("a port that is taken is logged and the daemon starts anyway", async () => {
    const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
    cleanups.push(() => taken.stop(true));
    const { daemon, dataDir, errors } = await boot({ telemetry: { port: taken.port } });
    expect(daemon.url).toMatch(/^ws:\/\//);
    expect(published(dataDir)).toBeNull();
    expect(errors.join("\n")).toContain("telemetry");
  });
});
