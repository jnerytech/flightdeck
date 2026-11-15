import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../../src/main.ts";
import { startServer } from "../../src/server.ts";
import { type TerminalInfo, TerminalManager } from "../../src/terminal/terminal-manager.ts";
import { newManager, poll, tempDir, workspace } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { fakePtys } from "../support/pty-helpers.ts";
import { cleanups, TOKEN, teardown } from "./daemon-setup.ts";

afterEach(teardown);

describe("terminal-daemon: over the protocol and wired into the daemon", () => {
  test("terminal.* pelo protocolo: abrir, anexar, escrever e receber a saída; a conexão cai e o terminal fica; outro anexa e vê o scrollback; o fim chega como terminal.exited", async () => {
    const { root, project } = workspace();
    const ptys = fakePtys();
    const manager = new TerminalManager({
      pty: ptys.factory,
      allowedRoots: [root],
      platform: "linux",
      env: () => ({ SHELL: "/bin/zsh" }),
      which: () => null,
    });
    cleanups.push(() => manager.stop());
    const { manager: sessions } = newManager();
    const server = startServer({
      manager: sessions,
      terminals: manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const first = new FrameClient(server.url);
    cleanups.push(() => first.close());
    await first.request("hello", { token: TOKEN, client: "t" });
    const opened = await first.data<TerminalInfo>("terminal.open", {
      cwd: project,
      cols: 90,
      rows: 20,
    });
    expect(opened).toMatchObject({ cwd: project, command: "zsh", cols: 90, rows: 20, attached: 0 });
    const terminalId = opened?.terminalId ?? "";
    expect(await first.data("terminal.attach", { terminalId })).toEqual({
      terminalId,
      scrollback: "",
      cols: 90,
      rows: 20,
      exitCode: null,
      flow: false,
    });
    expect(await first.data("terminal.write", { terminalId, data: "oi\r\n" })).toBeUndefined();
    expect(
      await first.data("terminal.resize", { terminalId, cols: 100, rows: 25 }),
    ).toBeUndefined();
    const dataFrames = (client: FrameClient) =>
      client.frames
        .filter((f) => f.type === "terminal.data")
        .map((f) => Buffer.from(String(f.data), "base64").toString());
    await poll(() => dataFrames(first).join("") === "oi\r\n");
    expect(dataFrames(first).join("")).toBe("oi\r\n");
    expect(
      (await first.data<{ terminals: TerminalInfo[] }>("terminal.list", {}))?.terminals[0],
    ).toMatchObject({ terminalId, attached: 1, cols: 100, rows: 25 });
    first.close();
    const second = new FrameClient(server.url);
    cleanups.push(() => second.close());
    await second.request("hello", { token: TOKEN, client: "t" });
    await poll(() => manager.list()[0]?.attached === 0);
    const attached = await second.data<{ scrollback: string }>("terminal.attach", { terminalId });
    expect(Buffer.from(attached?.scrollback ?? "", "base64").toString()).toBe("oi\r\n");
    ptys.spawned[0]?.emit("fim");
    ptys.spawned[0]?.exit(5);
    await poll(() => second.frames.some((f) => f.type === "terminal.exited"));
    expect(second.frames.filter((f) => f.type === "terminal.exited")).toEqual([
      { type: "terminal.exited", terminalId, exitCode: 5 },
    ]);
    expect(dataFrames(second).join("")).toBe("fim");
    expect(await second.data("terminal.detach", { terminalId })).toBeUndefined();
    expect(await second.data("terminal.close", { terminalId, kill: false })).toBeUndefined();
    expect((await second.data<{ terminals: unknown[] }>("terminal.list", {}))?.terminals).toEqual(
      [],
    );
  });

  test("terminal.* pelo protocolo: payload inválido e terminal desconhecido são recusados", async () => {
    const { root, project } = workspace();
    const manager = new TerminalManager({ pty: fakePtys().factory, allowedRoots: [root] });
    cleanups.push(() => manager.stop());
    const { manager: sessions } = newManager();
    const server = startServer({
      manager: sessions,
      terminals: manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const refused = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    expect(await refused("terminal.open", { cwd: project, cols: 0, rows: 24 })).toBe("bad_request");
    expect(await refused("terminal.open", { cwd: project, cols: 80, rows: 100_000 })).toBe(
      "bad_request",
    );
    expect(await refused("terminal.open", { cwd: project, cols: 80, rows: 24, command: [] })).toBe(
      "bad_request",
    );
    expect(await refused("terminal.write", { terminalId: "nada", data: "x".repeat(300_000) })).toBe(
      "bad_request",
    );
    expect(await refused("terminal.write", { terminalId: "nada", data: "x" })).toBe("not_found");
    expect(await refused("terminal.close", { terminalId: "nada" })).toBe("bad_request");
    expect(await refused("terminal.close", { terminalId: "nada", kill: true })).toBe("not_found");
  });

  test("o daemon liga o terminal: PTY injetado, terminal.max da config, o log do daemon, e o stop mata os terminais", async () => {
    const dir = tempDir();
    const { root, project } = workspace();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [root],
        history: { roots: [join(dir, "nada")] },
        terminal: { max: 1 },
      }),
    );
    const ptys = fakePtys();
    const logs: string[] = [];
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: (message) => logs.push(message), error: () => {} },
      { pty: ptys.factory },
    );
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const opened = await client.data<TerminalInfo>("terminal.open", {
      cwd: project,
      cols: 80,
      rows: 24,
    });
    expect(opened?.terminalId ?? "").not.toBe("");
    expect(logs.some((line) => line.includes(`terminal ${opened?.terminalId} aberto em`))).toBe(
      true,
    );
    const second = await client.request("terminal.open", { cwd: project, cols: 80, rows: 24 });
    expect((second.error as { code?: string } | undefined)?.code).toBe("invalid_state");
    await daemon.stop();
    expect(ptys.spawned.map((pty) => pty.killed)).toEqual([true]);
  });
});
