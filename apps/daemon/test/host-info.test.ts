import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { claudeVersionProbe } from "../src/claude-probe.ts";
import { startDaemon } from "../src/main.ts";
import { type RunningServer, type ServerOptions, startServer } from "../src/server.ts";
import { newManager, poll, tempDir } from "./helpers.ts";

const TOKEN = "host-info-token-0123456789";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/** hello + host.info; returns the `data` of a successful ack, or the error/`null`. */
async function hostInfo(url: string): Promise<Record<string, unknown> | null> {
  const ws = new WebSocket(url);
  const acks: protocol.Ack[] = [];
  ws.addEventListener("message", (m) => {
    const msg = protocol.parseServerMessage(String(m.data));
    if (msg.type === "ack") acks.push(msg);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
  ws.send(JSON.stringify({ id: "2", type: "host.info", payload: {} }));
  const ack = await poll(() => acks.find((a) => a.id === "2"), 2000);
  ws.close();
  if (!ack) return null;
  return ack.ok ? (ack.data as Record<string, unknown>) : { error: ack.error.code };
}

function serve(extra: Partial<ServerOptions>, managerOpts: Parameters<typeof newManager>[0] = {}) {
  const ctx = newManager(managerOpts);
  const server: RunningServer = startServer({
    manager: ctx.manager,
    hostName: "pi",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
    ...extra,
  });
  stops.push(() => server.stop());
  return { ...ctx, server };
}

function configFile(content: object) {
  const dir = tempDir();
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({ port: 0, token: TOKEN, dataDir: join(dir, "data"), ...content }),
  );
  return file;
}

const quiet = { log: () => {}, error: () => {} };

describe("host-info", () => {
  test("host.info devolve sistema, versões, caminho do claude e sessões ativas", async () => {
    const { server, manager, project } = serve({
      claude: { path: "/usr/bin/claude", version: async () => "2.1.0 (Claude Code)" },
    });
    manager.create({ cwd: project, prompt: "[tool]" });
    await poll(() => manager.list()[0]?.status === "awaiting_permission");

    expect(protocol.Command.safeParse({ id: "1", type: "host.info", payload: {} }).success).toBe(
      true,
    );
    const info = await hostInfo(server.url);
    expect(info).toMatchObject({
      hostName: "pi",
      os: process.platform,
      arch: process.arch,
      claudeVersion: "2.1.0 (Claude Code)",
      claudePath: "/usr/bin/claude",
      activeSessions: 1,
      apiKeySanitized: true,
    });
    expect(String(info?.daemonVersion)).toMatch(/^\d+\.\d+\.\d+/);
    expect(Number.isInteger(info?.uptimeSec) && Number(info?.uptimeSec) >= 0).toBe(true);
    expect(protocol.HostInfoResult?.safeParse(info).success).toBe(true);
  });

  test("apiKeySanitized é false só quando a chave chega de fato ao Claude", async () => {
    const leaking = serve({}, { allowApiKey: true, baseEnv: { ANTHROPIC_API_KEY: "sk" } });
    const allowedButAbsent = serve({}, { allowApiKey: true, baseEnv: {} });
    const sanitized = serve({}, { allowApiKey: false, baseEnv: { ANTHROPIC_API_KEY: "sk" } });
    const field = async (s: { server: RunningServer }) =>
      (await hostInfo(s.server.url))?.apiKeySanitized;
    expect(await field(leaking)).toBe(false);
    expect(await field(allowedButAbsent)).toBe(true);
    expect(await field(sanitized)).toBe(true);
  });

  test("sem sonda configurada, versão e caminho do claude são null", async () => {
    expect(await hostInfo(serve({}).server.url)).toMatchObject({
      claudeVersion: null,
      claudePath: null,
    });
  });

  test("a sonda roda `<claude> --version` uma vez e devolve null em falha", async () => {
    const calls: string[][] = [];
    const ok = claudeVersionProbe("/opt/claude", async (cmd) => {
      calls.push(cmd);
      return { code: 0, stdout: "2.1.0 (Claude Code)\n" };
    });
    expect(await ok()).toBe("2.1.0 (Claude Code)");
    expect(await ok()).toBe("2.1.0 (Claude Code)");
    expect(calls).toEqual([["/opt/claude", "--version"]]);

    expect(await claudeVersionProbe("x", async () => ({ code: 1, stdout: "" }))()).toBeNull();
    expect(
      await claudeVersionProbe("x", async () => {
        throw new Error("ENOENT");
      })(),
    ).toBeNull();
  });

  test("sem caminho do claude resolvido, a sonda não executa nada e devolve null", async () => {
    const calls: unknown[] = [];
    const probe = claudeVersionProbe(null, async (cmd) => {
      calls.push(cmd);
      return { code: 0, stdout: "1.0.0" };
    });
    expect(await probe()).toBeNull();
    expect(calls).toEqual([]);
  });

  test("com runtime fake o daemon informa null e não executa o claude", async () => {
    const file = configFile({ claude: { executablePath: "/nao/existe/claude" } });
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      quiet,
    );
    stops.push(() => daemon.stop());
    expect(await hostInfo(daemon.url)).toMatchObject({ claudeVersion: null, claudePath: null });
  });

  test("com runtime claude o daemon informa o executablePath e a versão da sonda real", async () => {
    // Nonexistent path: the real probe fails to start it and reports null (docs/TDD.md).
    const file = configFile({ claude: { executablePath: "/nao/existe/claude" } });
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "claude" },
      {},
      quiet,
    );
    stops.push(() => daemon.stop());
    expect(await hostInfo(daemon.url)).toMatchObject({
      claudeVersion: null,
      claudePath: "/nao/existe/claude",
    });
  });
});
