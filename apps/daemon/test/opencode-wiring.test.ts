import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import { REAL_KILL_DEPS } from "../src/runtime/opencode-runtime.ts";
import { installFakeOpenCode } from "./fake-opencode.ts";
import { poll, tempDir } from "./helpers.ts";

setDefaultTimeout(60_000);

const TOKEN = "opencode-wiring-token-0123456789";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});
const quiet = { log: () => {}, error: () => {} };

/** A socket that keeps the acks and the session events it gets. */
async function client(url: string) {
  const ws = new WebSocket(url);
  const acks: protocol.Ack[] = [];
  const events: protocol.SessionEvent[] = [];
  ws.addEventListener("message", (m) => {
    const msg = protocol.parseServerMessage(String(m.data));
    if (msg.type === "ack") acks.push(msg);
    if (msg.type === "event") events.push(msg.event);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const ask = async (type: string, payload: object) => {
    const key = String(++id);
    ws.send(JSON.stringify({ id: key, type, payload }));
    return poll(() => acks.find((a) => a.id === key), 30_000);
  };
  await ask("hello", { token: TOKEN, client: "t" });
  stops.push(async () => ws.close());
  return { ask, events };
}

async function daemon(opencode: object | null) {
  const fake = installFakeOpenCode();
  const dir = tempDir("fd-oc-wiring-");
  const root = join(dir, "root");
  mkdirSync(join(root, "project"), { recursive: true });
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [root],
      claude: { executablePath: "/nao/existe/claude" },
      ...(opencode ? { opencode } : {}),
    }),
  );
  const env = { ...process.env, PATH: `${fake.dir}${delimiter}${process.env.PATH ?? ""}` };
  const running = await startDaemon(
    { command: "start", config: file, runtime: "claude" },
    env,
    quiet,
  );
  stops.push(() => running.stop());
  return { fake, project: join(root, "project"), url: running.url };
}

const dataOf = (ack: protocol.Ack | null) => (ack?.ok ? ack.data : ack) as Record<string, unknown>;

describe("opencode-wiring", () => {
  test("turned off (the default) it is listed as such, and OpenCode is never run", async () => {
    const { fake, url } = await daemon(null);
    const { ask } = await client(url);
    const info = dataOf(await ask("host.info", {})) as protocol.HostInfoResult;
    expect(info.runtimes).toEqual([
      { kind: "opencode", available: false, reason: "opencode_disabled" },
    ]);
    expect(fake.calls()).toEqual([]);
  });

  test("turned on, the host finds it, checks it with project config off, and lists it with its models", async () => {
    const { fake, url } = await daemon({ enabled: true });
    const { ask } = await client(url);
    const info = dataOf(await ask("host.info", {})) as protocol.HostInfoResult;
    const runtime = info.runtimes?.[0];
    expect([runtime?.kind, runtime?.available, runtime?.version, runtime?.verified]).toEqual([
      "opencode",
      true,
      "2.2.5",
      true,
    ]);
    expect(String(runtime?.path).startsWith(fake.dir)).toBe(true);
    expect(info.features ?? []).toContain("opencode");
    expect(dataOf(await ask("runtime.models", { runtime: "opencode" }))).toEqual({
      models: [
        { id: "anthropic/claude-sonnet-5-5", name: "anthropic/claude-sonnet-5-5" },
        { id: "opencode/crouton-alpha-free", name: "opencode/crouton-alpha-free" },
      ],
    });
    const ran = fake.calls().map((c) => [c.args.join(" "), c.disableProjectConfig]);
    expect(ran.slice(0, 2)).toEqual([
      ["--version", "1"],
      ["api GET /api/config --standalone", "1"],
    ]);
  });

  test("an OpenCode session runs end to end: preflight, a question answered, the turn with its cost", async () => {
    const { fake, project, url } = await daemon({ enabled: true });
    const { ask, events } = await client(url);
    const created = dataOf(
      await ask("session.create", { cwd: project, prompt: "run: echo hi", runtime: "opencode" }),
    );
    const sessionId = String(created.sessionId);
    await ask("session.subscribe", { sessionId });
    const requested = await poll(
      () => events.find((e) => e.type === "permission.requested"),
      30_000,
    );
    expect((requested as { toolName?: string } | null)?.toolName).toBe("Bash");
    await ask("permission.respond", {
      requestId: (requested as { requestId: string }).requestId,
      decision: "allow",
    });
    const turn = await poll(() => events.find((e) => e.type === "turn.result"), 30_000);
    expect(turn).toMatchObject({ subtype: "success", costUsd: 0.01 });
    const acp = fake.calls().find((c) => c.args[0] === "acp");
    expect([acp?.disableProjectConfig, acp?.hasConfigContent, acp?.session]).toEqual([
      "1",
      true,
      sessionId,
    ]);
    expect(fake.calls().filter((c) => c.args[0] === "api").length).toBeGreaterThanOrEqual(4);
  });

  test("the real kill: a group that is gone throws (the killer falls back), and a run spawns", () => {
    expect(() => REAL_KILL_DEPS.killGroup(2 ** 22 + 12345, "SIGTERM")).toThrow();
    expect(() => REAL_KILL_DEPS.run([process.execPath, "-e", ""])).not.toThrow();
  });
});
