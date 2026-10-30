import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { bunPty, type SpawnFn } from "../src/terminal/pty.ts";
import { Ring } from "../src/terminal/ring.ts";
import { defaultShell } from "../src/terminal/shell.ts";
import {
  type TerminalInfo,
  TerminalManager,
  type TerminalManagerOptions,
} from "../src/terminal/terminal-manager.ts";
import { newManager, poll, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { dataOf, fakePtys, fakeSink } from "./pty-helpers.ts";
import { manualTime } from "./time-helpers.ts";

const TOKEN = "terminal-token-0123456789abcdef";
const MB = 1024 * 1024;
const MIN = 60_000;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A manager over fake PTYs and a manual clock, on a Linux host with zsh. */
function setup(overrides: Partial<TerminalManagerOptions> = {}) {
  const { root, project } = workspace();
  const ptys = fakePtys();
  const time = manualTime();
  const logs: string[] = [];
  const manager = new TerminalManager({
    pty: ptys.factory,
    allowedRoots: [root],
    platform: "linux",
    env: () => ({ SHELL: "/bin/zsh", PATH: "/bin", ANTHROPIC_API_KEY: "sk-secreta", EXTRA: "1" }),
    which: (name) => (name === "bash" ? "/usr/bin/bash" : null),
    timers: time.timers,
    now: time.now,
    log: (message) => logs.push(message),
    ...overrides,
  });
  cleanups.push(() => manager.stop());
  const open = () => manager.open({ cwd: project, cols: 80, rows: 24 });
  return { manager, ptys, time, logs, project, root, open };
}

const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
};

const text = (frames: Parameters<typeof dataOf>[0]) => dataOf(frames).toString("utf8");

describe("terminal-daemon", () => {
  test("o shell padrão: pwsh, senão powershell, no Windows; $SHELL, bash, sh nos outros", () => {
    const which = (found: string[]) => (name: string) =>
      found.includes(name) ? `/x/${name}` : null;
    const shell = (platform: NodeJS.Platform, env: Record<string, string>, found: string[]) =>
      defaultShell({ platform, env, which: which(found) });
    expect(shell("win32", {}, ["pwsh", "powershell"])).toEqual(["/x/pwsh"]);
    expect(shell("win32", {}, ["powershell"])).toEqual(["/x/powershell"]);
    expect(shell("win32", {}, [])).toEqual(["powershell.exe"]);
    expect(shell("linux", { SHELL: "/bin/fish" }, ["bash"])).toEqual(["/bin/fish"]);
    expect(shell("linux", {}, ["bash", "sh"])).toEqual(["/x/bash"]);
    expect(shell("darwin", { SHELL: "" }, ["sh"])).toEqual(["/x/sh"]);
    expect(shell("linux", {}, [])).toEqual(["sh"]);
  });

  test("a janela circular guarda só os últimos bytes, na ordem", () => {
    const ring = new Ring(10);
    ring.append(new TextEncoder().encode("abcd"));
    expect(Buffer.from(ring.snapshot()).toString()).toBe("abcd");
    ring.append(new TextEncoder().encode("efghij"));
    ring.append(new TextEncoder().encode("klm"));
    expect(Buffer.from(ring.snapshot()).toString()).toBe("defghijklm");
    // One chunk bigger than the whole window.
    ring.append(new TextEncoder().encode("0123456789ABC"));
    expect(Buffer.from(ring.snapshot()).toString()).toBe("3456789ABC");
  });

  test("open: PTY com o shell padrão, o cwd real, o tamanho e o ambiente sem a chave de API; list mostra o terminal", () => {
    const { manager, ptys, project } = setup();
    const info = manager.open({ cwd: project, cols: 100, rows: 30 });
    expect(info).toEqual({
      terminalId: info.terminalId,
      cwd: project,
      command: "zsh",
      startedAt: "2026-10-01T12:00:00.000Z",
      attached: 0,
      cols: 100,
      rows: 30,
      exitCode: null,
      launchId: null,
    });
    expect(info.terminalId).toMatch(/^[0-9A-Z]{26}$/);
    expect(ptys.spawned).toHaveLength(1);
    expect(ptys.spawned[0]).toMatchObject({
      argv: ["/bin/zsh"],
      cwd: project,
      cols: 100,
      rows: 30,
      env: { SHELL: "/bin/zsh", PATH: "/bin", EXTRA: "1" },
    });
    expect(ptys.spawned[0]?.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(manager.list()).toEqual([info]);
  });

  test("open com command abre esse argv, sem shell; cwd fora de allowedRoots e spawn que falha são recusados", () => {
    const { manager, ptys, project, root } = setup();
    const info = manager.open({
      cwd: project,
      command: ["node", "--flag", "x.js"],
      cols: 80,
      rows: 24,
    });
    expect(ptys.spawned[0]?.argv).toEqual(["node", "--flag", "x.js"]);
    // Only the program is shown, never its arguments.
    expect(info.command).toBe("node");
    expect(code(() => manager.open({ cwd: tempDir("fora-"), cols: 80, rows: 24 }))).toBe(
      "forbidden_cwd",
    );
    expect(ptys.spawned).toHaveLength(1);
    const broken = new TerminalManager({
      pty: () => {
        throw new Error("programa não encontrado");
      },
      allowedRoots: [root],
    });
    expect(code(() => broken.open({ cwd: project, cols: 80, rows: 24 }))).toBe("invalid_state");
    expect(broken.list()).toEqual([]);
  });

  test("write, resize e attach com scrollback; a saída vai em lotes de até 16 KB a cada 16 ms, em base64", () => {
    const { manager, ptys, time, open } = setup();
    const { terminalId } = open();
    const pty = ptys.spawned[0];
    const a = fakeSink();
    expect(manager.attach(terminalId, a)).toEqual({
      terminalId,
      scrollback: "",
      cols: 80,
      rows: 24,
      exitCode: null,
    });
    manager.write(terminalId, "oi\r\n");
    expect(pty?.written).toEqual(["oi\r\n"]);
    time.advance(15);
    expect(a.frames).toEqual([]);
    time.advance(1);
    expect(a.frames).toEqual([
      { type: "terminal.data", terminalId, data: Buffer.from("oi\r\n").toString("base64") },
    ]);
    a.frames.length = 0;
    pty?.emit("a".repeat(40_000));
    time.advance(16);
    expect(
      a.frames.map((f) => (f.type === "terminal.data" ? Buffer.from(f.data, "base64").length : -1)),
    ).toEqual([16_384, 16_384, 7_232]);
    manager.resize(terminalId, 120, 40);
    expect(pty?.resized).toEqual([[120, 40]]);
    expect(manager.list()[0]).toMatchObject({ cols: 120, rows: 40, attached: 1 });
    a.frames.length = 0;
    manager.write(terminalId, "size\r");
    time.advance(16);
    expect(text(a.frames)).toBe("size\r120x40\r\n");
    // Whoever attaches later gets everything so far, and then only what comes next.
    const b = fakeSink();
    const late = manager.attach(terminalId, b);
    expect(Buffer.from(late.scrollback, "base64").toString()).toBe(
      `oi\r\n${"a".repeat(40_000)}size\r120x40\r\n`,
    );
    pty?.emit("novo");
    time.advance(16);
    expect(text(b.frames)).toBe("novo");
    expect(code(() => manager.write("nada", "x"))).toBe("not_found");
    expect(code(() => manager.resize("nada", 1, 1))).toBe("not_found");
    expect(code(() => manager.attach("nada", b))).toBe("not_found");
  });

  test("o terminal sobrevive à desconexão e o scrollback de 2 MB é reapresentado", () => {
    const { manager, ptys, open } = setup();
    const { terminalId } = open();
    const pty = ptys.spawned[0];
    const a = fakeSink();
    manager.attach(terminalId, a);
    manager.detachAll(a);
    pty?.emit("durante a ausência\r\n");
    expect(manager.list()[0]).toMatchObject({ attached: 0 });
    expect(pty?.killed).toBe(false);
    const b = fakeSink();
    expect(Buffer.from(manager.attach(terminalId, b).scrollback, "base64").toString()).toBe(
      "durante a ausência\r\n",
    );
    manager.detach(terminalId, b);
    for (const fill of ["a", "b", "c"]) pty?.emit(fill.repeat(MB));
    const kept = Buffer.from(manager.attach(terminalId, fakeSink()).scrollback, "base64");
    expect(kept.length).toBe(2 * MB);
    expect([kept[0], kept[kept.length - 1]]).toEqual(["b".charCodeAt(0), "c".charCodeAt(0)]);
  });

  test("sem ninguém anexado por idleMinutes (120) o terminal é encerrado; anexar zera a contagem", () => {
    const { manager, ptys, time, logs, open } = setup();
    open();
    const pty = ptys.spawned[0];
    time.advance(119 * MIN);
    expect(manager.list()).toHaveLength(1);
    const a = fakeSink();
    manager.attach(manager.list()[0]?.terminalId ?? "", a);
    time.advance(500 * MIN);
    expect(pty?.killed).toBe(false);
    manager.detachAll(a);
    time.advance(119 * MIN);
    expect(manager.list()).toHaveLength(1);
    time.advance(MIN);
    expect(pty?.killed).toBe(true);
    expect(manager.list()).toEqual([]);
    expect(logs.some((line) => line.includes("ocioso"))).toBe(true);
    const short = setup({ idleMinutes: 5 });
    short.open();
    short.time.advance(5 * MIN);
    expect(short.ptys.spawned[0]?.killed).toBe(true);
  });

  test("terminal.max vivos por host: o seguinte é recusado; os que já terminaram não contam", () => {
    const { manager, ptys, open } = setup({ max: 2 });
    open();
    open();
    expect(code(open)).toBe("invalid_state");
    ptys.spawned[0]?.exit(0);
    open();
    expect(manager.list()).toHaveLength(3);
  });

  test("cliente lento: a fila de 1 MB estoura, ele recebe terminal.resync e reanexa; o PTY segue lendo e o rápido não para", () => {
    const { manager, ptys, time, open } = setup();
    const { terminalId } = open();
    const pty = ptys.spawned[0];
    const slow = fakeSink();
    slow.backlogBytes = 2 * MB;
    const fast = fakeSink();
    manager.attach(terminalId, slow);
    manager.attach(terminalId, fast);
    const chunk = "x".repeat(100 * 1024);
    for (let i = 0; i < 15; i++) {
      pty?.emit(chunk);
      time.advance(16);
    }
    expect(slow.frames).toEqual([{ type: "terminal.resync", terminalId }]);
    expect(dataOf(fast.frames).length).toBe(15 * 100 * 1024);
    // Reading never stopped: what comes after is in the scrollback, and the slow one is quiet.
    pty?.emit("FIM\r\n");
    time.advance(16);
    expect(slow.frames).toHaveLength(1);
    slow.backlogBytes = 0;
    const again = manager.attach(terminalId, slow);
    expect(
      Buffer.from(again.scrollback, "base64")
        .toString()
        .endsWith(`${"x".repeat(10)}FIM\r\n`),
    ).toBe(true);
    slow.frames.length = 0;
    pty?.emit("depois\r\n");
    time.advance(16);
    expect(text(slow.frames)).toBe("depois\r\n");
  });

  test("conexão cheia mas fila pequena: a saída espera, em ordem, e sai quando o socket esvazia", () => {
    const { manager, ptys, time, open } = setup();
    const { terminalId } = open();
    const slow = fakeSink();
    slow.backlogBytes = 2 * MB;
    manager.attach(terminalId, slow);
    ptys.spawned[0]?.emit("um");
    time.advance(16);
    ptys.spawned[0]?.emit("dois");
    time.advance(16);
    expect(slow.frames).toEqual([]);
    slow.backlogBytes = 0;
    // While something is held the manager looks again every 16 ms.
    time.advance(16);
    expect(text(slow.frames)).toBe("umdois");
  });

  test("close com kill encerra e remove; sem kill só desanexa; o que já acabou é removido; desconhecido é not_found", () => {
    const { manager, ptys, open } = setup();
    const first = open();
    const a = fakeSink();
    manager.attach(first.terminalId, a);
    manager.close(first.terminalId, false);
    expect(manager.list()[0]).toMatchObject({ attached: 0 });
    expect(ptys.spawned[0]?.killed).toBe(false);
    manager.attach(first.terminalId, a);
    manager.close(first.terminalId, true);
    expect(ptys.spawned[0]?.killed).toBe(true);
    expect(a.frames.at(-1)).toEqual({
      type: "terminal.exited",
      terminalId: first.terminalId,
      exitCode: 143,
    });
    expect(manager.list()).toEqual([]);
    const second = open();
    ptys.spawned[1]?.exit(0);
    manager.close(second.terminalId, false);
    expect(manager.list()).toEqual([]);
    expect(code(() => manager.close("nada", true))).toBe("not_found");
  });

  test("o processo que termina sozinho manda terminal.exited depois da saída pendente; o terminal fica até fechar ou ficar ocioso", () => {
    const { manager, ptys, time, open } = setup();
    const { terminalId } = open();
    const a = fakeSink();
    manager.attach(terminalId, a);
    ptys.spawned[0]?.emit("último\r\n");
    ptys.spawned[0]?.exit(7);
    expect(a.frames.map((f) => f.type)).toEqual(["terminal.data", "terminal.exited"]);
    expect(text(a.frames)).toBe("último\r\n");
    expect(a.frames[1]).toEqual({ type: "terminal.exited", terminalId, exitCode: 7 });
    expect(manager.list()[0]).toMatchObject({ exitCode: 7, attached: 1 });
    expect(code(() => manager.write(terminalId, "x"))).toBe("invalid_state");
    expect(code(() => manager.resize(terminalId, 10, 10))).toBe("invalid_state");
    const late = manager.attach(terminalId, fakeSink());
    expect([late.exitCode, Buffer.from(late.scrollback, "base64").toString()]).toEqual([
      7,
      "último\r\n",
    ]);
    manager.detachAll(a);
    time.advance(120 * MIN);
    expect(manager.list()).toEqual([]);
    expect(ptys.spawned[0]?.killed).toBe(false);
  });

  test("o log registra abrir, anexar e encerrar com id, pasta e só o programa, nunca o conteúdo nem os argumentos", () => {
    const { manager, ptys, time, logs, project } = setup();
    const { terminalId } = manager.open({
      cwd: project,
      command: ["node", "--token=SEGREDO-ARG"],
      cols: 80,
      rows: 24,
    });
    const sink = fakeSink();
    manager.attach(terminalId, sink);
    manager.write(terminalId, "SEGREDO-42\r\n");
    time.advance(16);
    expect(text(sink.frames)).toContain("SEGREDO-42");
    manager.detach(terminalId, sink);
    manager.close(terminalId, true);
    expect(ptys.spawned[0]?.killed).toBe(true);
    expect(logs.map((line) => line.replace(terminalId, "<id>"))).toEqual([
      `terminal <id> aberto em ${project} (node)`,
      "terminal <id> anexado (1)",
      "terminal <id> desanexado (0)",
      "terminal <id> encerrado (código 143)",
    ]);
    expect(logs.join("\n")).not.toContain("SEGREDO");
  });

  test("stop mata todos os terminais", () => {
    const { manager, ptys, open } = setup();
    open();
    open();
    manager.stop();
    expect(ptys.spawned.map((p) => p.killed)).toEqual([true, true]);
    expect(manager.list()).toEqual([]);
  });

  test("o adaptador do Bun repassa tamanho, cwd e ambiente explícitos, dados, escrita, resize e kill; o código vem depois do fim da saída", async () => {
    const calls: Array<{ argv: string[]; options: Record<string, unknown> }> = [];
    const written: string[] = [];
    const resized: Array<[number, number]> = [];
    let killed = false;
    let ended!: (code: number) => void;
    const spawn: SpawnFn = (argv, options) => {
      calls.push({ argv, options });
      return {
        exited: new Promise<number>((resolve) => {
          ended = resolve;
        }),
        terminal: {
          write: (data) => {
            written.push(data);
            return data.length;
          },
          resize: (cols, rows) => {
            resized.push([cols, rows]);
          },
        },
        kill: () => {
          killed = true;
        },
      };
    };
    const got: string[] = [];
    const result: { exit: number | null } = { exit: null };
    const pty = bunPty(spawn)({
      argv: ["sh", "-c", "x"],
      cwd: "/w",
      env: { A: "1" },
      cols: 100,
      rows: 30,
      onData: (chunk) => got.push(Buffer.from(chunk).toString()),
      onExit: (c) => {
        result.exit = c;
      },
    });
    expect(calls[0]?.argv).toEqual(["sh", "-c", "x"]);
    expect(calls[0]?.options).toMatchObject({
      cwd: "/w",
      env: { A: "1" },
      terminal: { cols: 100, rows: 30 },
    });
    const terminal = calls[0]?.options.terminal as {
      data(t: unknown, chunk: Uint8Array): void;
      exit(t: unknown, code: number, signal: string | null): void;
    };
    terminal.data({}, new TextEncoder().encode("abc"));
    expect(got).toEqual(["abc"]);
    pty.write("ls\r");
    pty.resize(120, 40);
    pty.kill();
    expect([written, resized, killed]).toEqual([["ls\r"], [[120, 40]], true]);
    // The process ended but the output was not all read yet: not reported.
    ended(7);
    await Bun.sleep(5);
    expect(result.exit).toBeNull();
    terminal.exit({}, 0, null);
    await poll(() => result.exit !== null);
    expect(result.exit).toBe(7);
  });

  test("kill sends SIGHUP, which an interactive shell obeys (it ignores SIGTERM), and SIGKILL if the process is still there after the grace", async () => {
    const signals: Array<string | undefined> = [];
    let ended!: (code: number) => void;
    const spawn: SpawnFn = () => ({
      exited: new Promise<number>((resolve) => {
        ended = resolve;
      }),
      terminal: { write: () => 0, resize: () => {} },
      kill: (signal) => {
        signals.push(signal);
      },
    });
    const start = {
      argv: ["bash"],
      cwd: "/w",
      env: {},
      cols: 80,
      rows: 24,
      onData: () => {},
      onExit: () => {},
    };
    bunPty(spawn, 20)(start).kill();
    expect(signals).toEqual(["SIGHUP"]);
    await Bun.sleep(60);
    expect(signals).toEqual(["SIGHUP", "SIGKILL"]);
    // A process that ends within the grace gets nothing more.
    signals.length = 0;
    bunPty(spawn, 20)(start).kill();
    ended(129);
    await Bun.sleep(60);
    expect(signals).toEqual(["SIGHUP"]);
  });

  test("o adaptador do Bun também informa o fim quando o PTY não avisa o fim da saída", async () => {
    let ended!: (code: number) => void;
    const spawn: SpawnFn = () => ({
      exited: new Promise<number>((resolve) => {
        ended = resolve;
      }),
      terminal: { write: () => 0, resize: () => {} },
      kill: () => {},
    });
    const result: { exit: number | null } = { exit: null };
    bunPty(spawn)({
      argv: ["x"],
      cwd: "/w",
      env: {},
      cols: 80,
      rows: 24,
      onData: () => {},
      onExit: (c) => {
        result.exit = c;
      },
    });
    ended(3);
    expect(await poll(() => result.exit !== null, 2000)).toBe(true);
    expect(result.exit).toBe(3);
  });

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
