import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import { poll, tempDir } from "./helpers.ts";

const TOKEN = "opencode-fake-host-token-0123456789";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

async function fakeHost() {
  const dir = tempDir("fd-oc-fake-");
  const project = join(dir, "root", "project");
  mkdirSync(project, { recursive: true });
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [join(dir, "root")],
    }),
  );
  const running = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    process.env,
    {
      log: () => {},
      error: () => {},
    },
  );
  stops.push(() => running.stop());
  const ws = new WebSocket(running.url);
  const acks: protocol.Ack[] = [];
  const events: protocol.SessionEvent[] = [];
  ws.addEventListener("message", (m) => {
    const msg = protocol.parseServerMessage(String(m.data));
    if (msg.type === "ack") acks.push(msg);
    if (msg.type === "event") events.push(msg.event);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  stops.push(async () => ws.close());
  let id = 0;
  const ask = async (type: string, payload: object) => {
    const key = String(++id);
    ws.send(JSON.stringify({ id: key, type, payload }));
    const ack = await poll(() => acks.find((a) => a.id === key), 10_000);
    return (ack?.ok ? ack.data : ack) as Record<string, unknown>;
  };
  await ask("hello", { token: TOKEN, client: "t" });
  return { ask, events, project };
}

describe("opencode-fake-host", () => {
  test("a fake host offers a fake OpenCode, with models, without turning anything on", async () => {
    const { ask } = await fakeHost();
    const info = (await ask("host.info", {})) as protocol.HostInfoResult;
    expect(info.runtimes).toEqual([
      { kind: "opencode", available: true, path: "fake", version: "2.2.5", verified: true },
    ]);
    expect(info.features ?? []).toContain("opencode");
    const models = (await ask("runtime.models", { runtime: "opencode" })) as {
      models?: Array<{ id: string }>;
    };
    expect((models.models ?? []).map((m) => m.id)).toEqual([
      "anthropic/claude-sonnet-5-5",
      "openai/gpt-6.1-sol",
      "opencode/crouton-alpha-free",
    ]);
  });

  test("an OpenCode session on a fake host runs a turn and is stored as OpenCode's", async () => {
    const { ask, events, project } = await fakeHost();
    const created = await ask("session.create", {
      cwd: project,
      prompt: "hello",
      runtime: "opencode",
    });
    const sessionId = String(created.sessionId);
    await ask("session.subscribe", { sessionId });
    expect(await poll(() => events.find((e) => e.type === "turn.result"), 10_000)).not.toBe(null);
    const list = (await ask("session.list", {})) as { sessions?: protocol.SessionSummary[] };
    expect(list.sessions?.find((s) => s.id === sessionId)?.runtime).toBe("opencode");
  });
});
