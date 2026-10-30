import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostInfoResult } from "@flightdeck/protocol";
import {
  assertNoTauriCalls,
  installTauriGuard,
  tauriCalls,
} from "../../../scripts/test/tauri-guard.ts";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { startDaemon } from "../../daemon/src/main.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { isLocalUrl, terminalLaunch } from "../src/lib/terminal.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { tauriPlatform } = await import("../src/platform/tauri/index.ts");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const info = (patch: Partial<HostInfoResult>): HostInfoResult => ({
  hostName: "h",
  os: "win32",
  arch: "x64",
  daemonVersion: "0.8.0",
  claudeVersion: null,
  claudePath: null,
  uptimeSec: 1,
  activeSessions: 0,
  apiKeySanitized: false,
  ...patch,
});

const LOCAL = "ws://127.0.0.1:7777/v1/ws";
const WIN_FD = "C:\\Users\\dev\\.flightdeck\\bin\\flightdeckd.exe";
const target = { cwd: "C:\\repos\\meu app", claudeSessionId: "abc" };
const withWt = { windows: true, wt: true };
const withoutWt = { windows: true, wt: false };

describe("abrir-terminal", () => {
  test("host local no Windows: wt.exe com a pasta e o claude do flightdeckd, em lista", () => {
    const host = { url: LOCAL, hostInfo: info({ flightdeckdPath: WIN_FD }) };
    expect(terminalLaunch(host, target, withWt)).toEqual({
      kind: "spawn",
      program: "wt.exe",
      args: ["-d", "C:\\repos\\meu app", WIN_FD, "claude", "--resume", "abc"],
    });
    // Without a session (the project): a new claude in the folder.
    expect(terminalLaunch(host, { cwd: "C:\\repos\\x", claudeSessionId: null }, withWt)).toEqual({
      kind: "spawn",
      program: "wt.exe",
      args: ["-d", "C:\\repos\\x", WIN_FD, "claude"],
    });
  });

  test("sem wt.exe: cmd.exe /c start com cmd /k; sem caminho estável, o flightdeckd do PATH", () => {
    const host = { url: LOCAL, hostInfo: info({ flightdeckdPath: null }) };
    expect(terminalLaunch(host, target, withoutWt)).toEqual({
      kind: "spawn",
      program: "cmd.exe",
      args: [
        "/c",
        "start",
        "",
        "/d",
        "C:\\repos\\meu app",
        "cmd",
        "/k",
        "flightdeckd",
        "claude",
        "--resume",
        "abc",
      ],
    });
    // A daemon from before phase 8 says nothing about it either.
    expect(terminalLaunch({ url: LOCAL, hostInfo: info({}) }, target, withWt)).toEqual({
      kind: "spawn",
      program: "wt.exe",
      args: ["-d", "C:\\repos\\meu app", "flightdeckd", "claude", "--resume", "abc"],
    });
  });

  test("WSL supervisionado: wt.exe wsl.exe -d <distro> --cd <pasta> -- flightdeckd claude", () => {
    const fd = "/home/dev/.flightdeck/bin/flightdeckd";
    const host = {
      url: LOCAL,
      hostInfo: info({ os: "linux", wslDistro: "Ubuntu", flightdeckdPath: fd }),
    };
    const wsl = { cwd: "/home/dev/meu app", claudeSessionId: "abc" };
    const inside = [
      "wsl.exe",
      "-d",
      "Ubuntu",
      "--cd",
      "/home/dev/meu app",
      "--",
      fd,
      "claude",
      "--resume",
      "abc",
    ];
    expect(terminalLaunch(host, wsl, withWt)).toEqual({
      kind: "spawn",
      program: "wt.exe",
      args: inside,
    });
    expect(terminalLaunch(host, wsl, withoutWt)).toEqual({
      kind: "spawn",
      program: "cmd.exe",
      args: ["/c", "start", "", ...inside],
    });
  });

  test("outros hosts: copiar o comando, com aspas só quando precisa", () => {
    const remote = "ws://10.0.0.5:7777/v1/ws";
    const linux = info({ os: "linux" });
    expect(
      terminalLaunch(
        { url: remote, hostInfo: linux },
        { cwd: "/srv/app", claudeSessionId: "abc" },
        withWt,
      ),
    ).toEqual({
      kind: "copy",
      text: "cd /srv/app && flightdeckd claude --resume abc",
    });
    expect(
      terminalLaunch(
        { url: remote, hostInfo: linux },
        { cwd: "/srv/meu app's", claudeSessionId: null },
        withWt,
      ),
    ).toEqual({ kind: "copy", text: "cd '/srv/meu app'\\''s' && flightdeckd claude" });
    expect(
      terminalLaunch(
        { url: remote, hostInfo: info({ flightdeckdPath: WIN_FD.replace("dev", "o dev") }) },
        target,
        withWt,
      ),
    ).toEqual({
      kind: "copy",
      text: 'cd /d "C:\\repos\\meu app" && "C:\\Users\\o dev\\.flightdeck\\bin\\flightdeckd.exe" claude --resume abc',
    });
    // On this machine but not openable here: an app off Windows, an unknown OS, a Linux host
    // outside WSL (a tunnel), or a host whose info has not arrived.
    const local = { url: LOCAL, hostInfo: info({}) };
    expect(terminalLaunch(local, target, { windows: false, wt: false }).kind).toBe("copy");
    expect(terminalLaunch(local, target, null).kind).toBe("copy");
    expect(terminalLaunch({ url: LOCAL, hostInfo: linux }, target, withWt).kind).toBe("copy");
    expect(terminalLaunch({ url: LOCAL, hostInfo: null }, target, withWt).kind).toBe("copy");
    expect(isLocalUrl("ws://localhost:7777/v1/ws")).toBe(true);
    expect(isLocalUrl("ws://[::1]:7777/v1/ws")).toBe(true);
    expect(isLocalUrl("wss://pc.tail.ts.net/v1/ws")).toBe(false);
    expect(isLocalUrl("não é url")).toBe(false);
  });

  test("a casca Tauri recebe programa e argumentos em lista; a trava reprova a chamada real", async () => {
    const calls: Array<[string, unknown]> = [];
    const call = (async (cmd: string, args?: unknown) => {
      calls.push([cmd, args]);
      return cmd === "terminal_probe" ? { windows: true, wt: false } : undefined;
    }) as Parameters<typeof tauriPlatform>[1];
    const win = {
      localStorage: { getItem: () => null, setItem: () => {} },
      document: { hasFocus: () => true },
      navigator: { clipboard: { writeText: async () => {} } },
    };
    const platform = tauriPlatform(win, call);
    expect(platform.terminal.supported).toBe(true);
    expect(await platform.terminal.probe()).toEqual({ windows: true, wt: false });
    await platform.terminal.open("wt.exe", ["-d", "C:\\repos\\meu app"]);
    expect(calls).toEqual([
      ["terminal_probe", undefined],
      ["terminal_open", { program: "wt.exe", args: ["-d", "C:\\repos\\meu app"] }],
    ]);

    // The preload puts the sentinel on the Tauri bridge; here, one of our own shows it working.
    expect(
      (globalThis as { __TAURI_INTERNALS__?: { guard?: boolean } }).__TAURI_INTERNALS__?.guard,
    ).toBe(true);
    const scope: {
      __TAURI_INTERNALS__?: { invoke(cmd: string, args: unknown): Promise<unknown> };
    } = {};
    const guard = installTauriGuard(scope);
    expect(tauriCalls(guard)).toEqual([]);
    const reached = await scope.__TAURI_INTERNALS__
      ?.invoke("terminal_open", { program: "wt.exe" })
      .catch(() => "recusado");
    expect(reached).toBe("recusado");
    expect(tauriCalls(guard)).toEqual(['terminal_open {"program":"wt.exe"}']);
    expect(() => assertNoTauriCalls(guard)).toThrow("casca Tauri chamada 1 vez(es)");
  });

  test("host.info informa o flightdeckd estável quando existe e a distro do WSL", async () => {
    const dir = realTempDir("fd-term-");
    const home = join(dir, "home");
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ port: 0, token: TOKEN, dataDir: join(dir, "data") }));
    const quiet = { log: () => {}, error: () => {} };
    const env = { HOME: home, USERPROFILE: home };
    const hostInfo = async (vars: Record<string, string>) => {
      const daemon = await startDaemon(
        { command: "start", config: file, runtime: "fake" },
        vars,
        quiet,
      );
      const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
      try {
        await store.addHost({ name: "pc", url: daemon.url, token: TOKEN });
        await poll(() => store.getState().hosts[0]?.hostInfo, 3000);
        const result = store.getState().hosts[0]?.hostInfo;
        return { flightdeckdPath: result?.flightdeckdPath, wslDistro: result?.wslDistro };
      } finally {
        store.dispose();
        await daemon.stop();
      }
    };
    expect(await hostInfo(env)).toEqual({ flightdeckdPath: null, wslDistro: null });
    const stable = join(
      home,
      ".flightdeck",
      "bin",
      process.platform === "win32" ? "flightdeckd.exe" : "flightdeckd",
    );
    mkdirSync(join(stable, ".."), { recursive: true });
    writeFileSync(stable, "");
    expect(await hostInfo({ ...env, WSL_DISTRO_NAME: "Ubuntu" })).toEqual({
      flightdeckdPath: stable,
      wslDistro: "Ubuntu",
    });
  });

  test("a versão web não abre terminal: só copia, e a sondagem diz que não há Windows nem wt", async () => {
    const { platform } = memoryPlatform();
    expect(platform.terminal.supported).toBe(false);
    expect(await platform.terminal.probe()).toEqual({ windows: false, wt: false });
    await platform.terminal.open("wt.exe", []);
  });

  test("o executor que falha (programa ausente) vira aviso no banner", async () => {
    // The host announces a WSL distro, so the terminal opens in either OS the suite runs on: this
    // Windows (win32) or a supervised distro (linux). Never the clipboard.
    const d = makeDaemon(cleanups, { terminal: { flightdeckdPath: null, wslDistro: "Ubuntu" } });
    const mem = memoryPlatform();
    const copied: string[] = [];
    mem.platform.copyText = async (text) => {
      copied.push(text);
    };
    mem.platform.terminal = {
      supported: true,
      probe: async () => ({ windows: true, wt: true }),
      open: async () => {
        throw new Error("wt.exe não encontrado");
      },
    };
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    await store.init();
    const hostId = await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    await poll(() => store.getState().hosts[0]?.hostInfo, 3000);
    await store.openInTerminal(hostId, { cwd: d.project, claudeSessionId: null });
    expect(store.getState().error ?? "").toContain(
      "Terminal não abriu: Error: wt.exe não encontrado",
    );
    expect(copied).toEqual([]);
  });

  test("botão na sessão, no card e no projeto abre pelo executor injetado; sem terminal, copia", async () => {
    const FD = "/opt/fd/flightdeckd";
    const d = makeDaemon(cleanups, { terminal: { flightdeckdPath: FD, wslDistro: "Ubuntu" } });
    const repo = join(d.root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "README.md"), "# repo\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "inicial");
    const project = await d.board.addProject({ path: repo, promptTemplate: "" });
    const card = d.board.createCard(project.id, { title: "Ajuste", description: "faça" });
    await d.board.startCard(card.id);
    await poll(() => d.board.getCard(card.id).sessionStatus === "idle", 8000);
    const started = d.board.getCard(card.id);
    const cardSession = d.manager.get(started.sessionId ?? "").claudeSessionId;
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", name: "Gerenciada" });
    await poll(() => d.manager.get(sessionId).status === "idle");
    const managed = d.manager.get(sessionId).claudeSessionId;

    // The daemon's OS decides: this machine's Windows, or a WSL distro on a Linux runner.
    const expected = (cwd: string, id: string | null) => {
      const claude = [FD, "claude", ...(id ? ["--resume", id] : [])];
      return process.platform === "win32"
        ? ["wt.exe", ["-d", cwd, ...claude]]
        : ["wt.exe", ["wsl.exe", "-d", "Ubuntu", "--cd", cwd, "--", ...claude]];
    };
    const opened: Array<[string, string[]]> = [];
    const mem = memoryPlatform();
    mem.platform.terminal = {
      supported: true,
      probe: async () => ({ windows: true, wt: true }),
      open: async (program, args) => {
        opened.push([program, args]);
      },
    };
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    const url = d.listen().url;
    await act(async () => {
      await store.addHost({ name: "alfa", url, token: TOKEN });
    });
    await settle(
      () => store.getState().hosts[0]?.hostInfo !== null && store.getState().terminalEnv !== null,
    );
    const hostId = store.getState().hosts[0]?.id ?? "";

    // The session.
    await act(async () => store.select(hostId, sessionId));
    await settle(() => screen.queryByRole("button", { name: "Abrir no terminal" }) !== null);
    await click("Abrir no terminal");
    await settle(() => opened.length === 1);
    expect(opened[0]).toEqual(expected(d.project, managed) as [string, string[]]);

    // The project.
    await sidebar.hostAction("Projetos", "alfa");
    await settle(() => screen.queryByRole("button", { name: "Abrir repo no terminal" }) !== null);
    await click("Abrir repo no terminal");
    await settle(() => opened.length === 2);
    expect(opened[1]).toEqual(expected(repo, null) as [string, string[]]);

    // The card: its worktree and its session.
    await click("Abrir board de repo");
    await settle(() => screen.queryByLabelText("Card Ajuste") !== null);
    const openCard = screen.queryByLabelText("Card Ajuste")?.querySelector("button") ?? null;
    expect(openCard).not.toBeNull();
    await act(async () => {
      fireEvent.click(openCard as HTMLElement);
    });
    await settle(() => screen.queryByRole("button", { name: "Abrir no terminal" }) !== null);
    await click("Abrir no terminal");
    await settle(() => opened.length === 3);
    expect(opened[2]).toEqual(
      expected(started.worktreePath ?? "", cardSession) as [string, string[]],
    );
    cleanup();

    // An app that cannot open terminals (the web build) offers the command instead.
    const web = memoryPlatform();
    const copied: string[] = [];
    web.platform.copyText = async (text) => {
      copied.push(text);
    };
    const copier = new AppStore(web.platform, { baseDelayMs: 60_000 });
    render(<App store={copier} />);
    await act(async () => {
      await copier.addHost({ name: "alfa", url, token: TOKEN });
    });
    await settle(() => copier.getState().hosts[0]?.hostInfo !== null);
    await act(async () => copier.select(copier.getState().hosts[0]?.id ?? "", sessionId));
    await settle(() => screen.queryByRole("button", { name: "Copiar comando" }) !== null);
    await click("Copiar comando");
    await settle(() => copied.length === 1);
    const cd = process.platform === "win32" ? `cd /d ${d.project}` : `cd ${d.project}`;
    expect(copied).toEqual([`${cd} && ${FD} claude --resume ${managed}`]);
    expect(opened).toHaveLength(3);
  });
});
