import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { startDaemon } from "../src/main.ts";
import { loopbackBind, terminalEnabled } from "../src/terminal/policy.ts";
import { TerminalManager } from "../src/terminal/terminal-manager.ts";
import { poll, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { fakePtys, fakeSink } from "./pty-helpers.ts";

const TOKEN = "terminal-safety-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

interface HostInfo {
  features: string[];
  terminal?: { enabled: boolean; max: number; shell: string };
}

/** A daemon on fake PTYs, and a client on its loopback address (whatever it binds). */
async function daemon(config: Record<string, unknown> = {}) {
  const dir = tempDir();
  const { root, project } = workspace();
  const file = join(dir, "config.json");
  const dataDir = join(dir, "data");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir,
      allowedRoots: [root],
      history: { roots: [join(dir, "nada")] },
      ...config,
    }),
  );
  const ptys = fakePtys();
  const logs: string[] = [];
  const running = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: (message) => logs.push(message), error: () => {} },
    { pty: ptys.factory },
  );
  cleanups.push(() => running.stop());
  const client = new FrameClient(`ws://127.0.0.1:${new URL(running.url).port}/v1/ws`);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return {
    running,
    client,
    ptys,
    logs,
    project,
    file,
    dataDir,
    info: () => client.data<HostInfo>("host.info", {}),
    codeOf: async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok",
  };
}

describe("terminal-seguranca", () => {
  test("o terminal liga sozinho só quando o daemon escuta em loopback; a config manda", () => {
    for (const bind of ["127.0.0.1", "127.5.6.7", "::1", "localhost"]) {
      expect([bind, loopbackBind(bind)]).toEqual([bind, true]);
    }
    for (const bind of ["0.0.0.0", "::", "100.101.102.103", "192.168.1.5", "fd7a:115c:a1e0::1"]) {
      expect([bind, loopbackBind(bind)]).toEqual([bind, false]);
    }
    expect(terminalEnabled("127.0.0.1", undefined)).toBe(true);
    expect(terminalEnabled("0.0.0.0", undefined)).toBe(false);
    expect(terminalEnabled("0.0.0.0", true)).toBe(true);
    expect(terminalEnabled("127.0.0.1", false)).toBe(false);
  });

  test("desligado, todo comando de terminal é recusado com terminal_disabled; ligar e desligar são registrados e desligar encerra os terminais", () => {
    const { root, project } = workspace();
    const ptys = fakePtys();
    const logs: string[] = [];
    const manager = new TerminalManager({
      pty: ptys.factory,
      allowedRoots: [root],
      enabled: false,
      platform: "linux",
      env: () => ({ SHELL: "/bin/zsh" }),
      log: (message) => logs.push(message),
    });
    cleanups.push(() => manager.stop());
    const sink = fakeSink();
    const code = (fn: () => unknown) => {
      try {
        fn();
        return "ok";
      } catch (error) {
        return (error as { code?: string }).code ?? "sem código";
      }
    };
    expect(manager.enabled).toBe(false);
    expect(manager.settings()).toEqual({ enabled: false, max: 10, shell: "zsh" });
    expect([
      code(() => manager.open({ cwd: project, cols: 80, rows: 24 })),
      code(() => manager.write("t", "x")),
      code(() => manager.resize("t", 1, 1)),
      code(() => manager.attach("t", sink)),
      code(() => manager.detach("t", sink)),
      code(() => manager.close("t", true)),
      code(() => manager.list()),
    ]).toEqual(Array(7).fill("terminal_disabled"));
    expect(ptys.spawned).toEqual([]);
    // A connection closing is not a command: it never fails.
    expect(code(() => manager.detachAll(sink))).toBe("ok");
    manager.setEnabled(true);
    expect(manager.enabled).toBe(true);
    manager.open({ cwd: project, cols: 80, rows: 24 });
    manager.setEnabled(false);
    expect(ptys.spawned.map((pty) => pty.killed)).toEqual([true]);
    expect(code(() => manager.list())).toBe("terminal_disabled");
    manager.setEnabled(true);
    expect(manager.list()).toEqual([]);
    expect(logs.filter((line) => /ligado|desligado/.test(line))).toEqual([
      "terminal ligado",
      "terminal desligado (1 encerrado)",
      "terminal ligado",
    ]);
  });

  test("no loopback o terminal vem ligado: a feature e terminal em host.info", async () => {
    const { info, client, project } = await daemon();
    const host = await info();
    expect(host?.features).toContain("terminal");
    expect(host?.terminal).toEqual({ enabled: true, max: 10, shell: host?.terminal?.shell ?? "" });
    expect(host?.terminal?.shell).not.toBe("");
    expect(await client.data("terminal.open", { cwd: project, cols: 80, rows: 24 })).toMatchObject({
      cwd: project,
    });
  });

  test("fora do loopback vem desligado: sem a feature, comandos recusados; ligar pede confirmação, grava na config e vale na hora; desligar encerra os terminais", async () => {
    const { info, client, codeOf, project, file, ptys, logs } = await daemon({ bind: "0.0.0.0" });
    let host = await info();
    expect(host?.features).not.toContain("terminal");
    expect(host?.terminal).toEqual({ enabled: false, max: 10, shell: host?.terminal?.shell ?? "" });
    expect(await codeOf("terminal.open", { cwd: project, cols: 80, rows: 24 })).toBe(
      "terminal_disabled",
    );
    expect(await codeOf("terminal.list", {})).toBe("terminal_disabled");
    // Turning it on asks for confirmation.
    expect(await codeOf("terminal.settings", { enabled: true })).toBe("invalid_state");
    expect(await codeOf("terminal.settings", { enabled: true, confirm: false })).toBe(
      "invalid_state",
    );
    expect((await info())?.features).not.toContain("terminal");
    expect(await client.data("terminal.settings", { enabled: true, confirm: true })).toEqual({
      enabled: true,
      max: 10,
      shell: host?.terminal?.shell ?? "",
    });
    host = await info();
    expect(host?.features).toContain("terminal");
    expect(loadConfig(file).terminal.enabled).toBe(true);
    expect(await codeOf("terminal.open", { cwd: project, cols: 80, rows: 24 })).toBe("ok");
    // Turning it off needs no confirmation, and ends what is running.
    expect(await client.data("terminal.settings", { enabled: false })).toMatchObject({
      enabled: false,
    });
    expect(ptys.spawned.map((pty) => pty.killed)).toEqual([true]);
    expect((await info())?.features).not.toContain("terminal");
    expect(loadConfig(file).terminal.enabled).toBe(false);
    expect(await codeOf("terminal.list", {})).toBe("terminal_disabled");
    expect(logs.filter((line) => /terminal (ligado|desligado)/.test(line))).toHaveLength(2);
  });

  test("terminal.enabled false na config desliga também no loopback", async () => {
    const { info, codeOf, project } = await daemon({ terminal: { enabled: false } });
    expect((await info())?.features).not.toContain("terminal");
    expect(await codeOf("terminal.open", { cwd: project, cols: 80, rows: 24 })).toBe(
      "terminal_disabled",
    );
  });

  test("o conteúdo do terminal nunca vai para o log nem para o banco", async () => {
    const marker = "SEGREDO-NO-BANCO-42";
    const { running, client, project, logs, dataDir } = await daemon();
    const opened = await client.data<{ terminalId: string }>("terminal.open", {
      cwd: project,
      cols: 80,
      rows: 24,
    });
    const terminalId = opened?.terminalId ?? "";
    await client.request("terminal.attach", { terminalId });
    await client.request("terminal.write", { terminalId, data: `${marker}\r\n` });
    // The content did go through to the client…
    const seen = () =>
      client.frames.some(
        (f) =>
          f.type === "terminal.data" &&
          Buffer.from(String(f.data), "base64").toString().includes(marker),
      );
    await poll(seen);
    expect(seen()).toBe(true);
    await running.stop();
    // …and nowhere else.
    expect(logs.join("\n")).not.toContain(marker);
    const files = readdirSync(dataDir).filter((name) => name.startsWith("flightdeck.db"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect([name, readFileSync(join(dataDir, name)).includes(marker)]).toEqual([name, false]);
    }
  });
});
