import { afterEach, describe, expect, test } from "bun:test";
import { Ring } from "../../src/terminal/domain/ring.ts";
import { defaultShell } from "../../src/terminal/domain/shell.ts";
import { TerminalManager } from "../../src/terminal/terminal-manager.ts";
import { tempDir } from "../support/helpers.ts";
import { dataOf, fakeSink } from "../support/pty-helpers.ts";
import { code, MB, MIN, setup, teardown, text } from "./daemon-setup.ts";

afterEach(teardown);

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

  test("open: PTY com o shell padrão, o cwd real, o tamanho e o ambiente sem a chave de API; list mostra o terminal", async () => {
    const { manager, ptys, project } = setup();
    const info = await manager.open({ cwd: project, cols: 100, rows: 30 });
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

  test("the shell is told it talks to an xterm, whatever the daemon's own TERM is: a service has none, and readline then scrolls a long line sideways", async () => {
    const bare = setup();
    await bare.open();
    expect(bare.ptys.spawned[0]?.env.TERM).toBe("xterm-256color");
    expect(bare.ptys.spawned[0]?.env.COLORTERM).toBe("truecolor");
    const dumb = setup({ env: () => ({ SHELL: "/bin/zsh", TERM: "dumb" }) });
    await dumb.open();
    expect(dumb.ptys.spawned[0]?.env.TERM).toBe("xterm-256color");
    // What a client asks for still wins.
    const asked = setup();
    await asked.manager.open({ cwd: asked.project, cols: 80, rows: 24, env: { TERM: "screen" } });
    expect(asked.ptys.spawned[0]?.env.TERM).toBe("screen");
  });

  // Issue #486: in Claude Code's fullscreen mode each wheel notch reaches it as one report, and it
  // moves by its own CLAUDE_CODE_SCROLL_SPEED; 3 matches what Windows Terminal and VS Code feel like.
  test("Claude Code scrolls 3 lines a wheel notch unless the host or the client sets its speed", async () => {
    const plain = setup();
    await plain.open();
    const host = setup({ env: () => ({ SHELL: "/bin/zsh", CLAUDE_CODE_SCROLL_SPEED: "7" }) });
    await host.open();
    const asked = setup();
    await asked.manager.open({
      cwd: asked.project,
      cols: 80,
      rows: 24,
      env: { CLAUDE_CODE_SCROLL_SPEED: "1" },
    });
    expect(
      [plain, host, asked].map((s) => s.ptys.spawned[0]?.env.CLAUDE_CODE_SCROLL_SPEED),
    ).toEqual(["3", "7", "1"]);
  });

  // fd-coordinator's review of #486: /scroll-speed keeps the person's value in the env block of
  // ~/.claude/settings.json; the daemon's default must never shadow it.
  test("a speed the person keeps in Claude Code's settings is left to Claude Code, unset by the daemon", async () => {
    const kept = setup({ claudeEnv: async () => ({ CLAUDE_CODE_SCROLL_SPEED: "5" }) });
    await kept.open();
    const other = setup({ claudeEnv: async () => ({ SOMETHING_ELSE: "1" }) });
    await other.open();
    expect(
      [kept, other].map((s) => s.ptys.spawned[0]?.env.CLAUDE_CODE_SCROLL_SPEED ?? "unset"),
    ).toEqual(["unset", "3"]);
  });

  test("open com command abre esse argv, sem shell; cwd fora de allowedRoots e spawn que falha são recusados", async () => {
    const { manager, ptys, project, root } = setup();
    const info = await manager.open({
      cwd: project,
      command: ["node", "--flag", "x.js"],
      cols: 80,
      rows: 24,
    });
    expect(ptys.spawned[0]?.argv).toEqual(["node", "--flag", "x.js"]);
    // Only the program is shown, never its arguments.
    expect(info.command).toBe("node");
    await expect(manager.open({ cwd: tempDir("fora-"), cols: 80, rows: 24 })).rejects.toMatchObject(
      {
        code: "forbidden_cwd",
      },
    );
    expect(ptys.spawned).toHaveLength(1);
    const broken = new TerminalManager({
      pty: () => {
        throw new Error("programa não encontrado");
      },
      allowedRoots: [root],
    });
    expect(await code(() => broken.open({ cwd: project, cols: 80, rows: 24 }))).toBe(
      "invalid_state",
    );
    expect(broken.list()).toEqual([]);
  });

  test("write, resize e attach com scrollback; a saída vai em lotes de até 16 KB a cada 16 ms, em base64", async () => {
    const { manager, ptys, time, open } = setup();
    const { terminalId } = await open();
    const pty = ptys.spawned[0];
    const a = fakeSink();
    expect(manager.attach(terminalId, a)).toEqual({
      terminalId,
      scrollback: "",
      cols: 80,
      rows: 24,
      exitCode: null,
      flow: false,
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
    expect(await code(() => manager.write("nada", "x"))).toBe("not_found");
    expect(await code(() => manager.resize("nada", 1, 1))).toBe("not_found");
    expect(await code(() => manager.attach("nada", b))).toBe("not_found");
  });

  test("o terminal sobrevive à desconexão e o scrollback de 2 MB é reapresentado", async () => {
    const { manager, ptys, open } = setup();
    const { terminalId } = await open();
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
    expect(kept).toHaveLength(2 * MB);
    expect([kept[0], kept[kept.length - 1]]).toEqual(["b".charCodeAt(0), "c".charCodeAt(0)]);
  });

  test("sem ninguém anexado por idleMinutes (120) o terminal é encerrado; anexar zera a contagem", async () => {
    const { manager, ptys, time, logs, open } = setup();
    await open();
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
    await short.open();
    short.time.advance(5 * MIN);
    expect(short.ptys.spawned[0]?.killed).toBe(true);
  });

  test("terminal.max vivos por host: o seguinte é recusado; os que já terminaram não contam", async () => {
    const { manager, ptys, open } = setup({ max: 2 });
    await open();
    await open();
    expect(await code(open)).toBe("invalid_state");
    ptys.spawned[0]?.exit(0);
    await open();
    expect(manager.list()).toHaveLength(3);
  });

  test("cliente lento: a fila de 1 MB estoura, ele recebe terminal.resync e reanexa; o PTY segue lendo e o rápido não para", async () => {
    const { manager, ptys, time, open } = setup();
    const { terminalId } = await open();
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
    expect(dataOf(fast.frames)).toHaveLength(15 * 100 * 1024);
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

  test("conexão cheia mas fila pequena: a saída espera, em ordem, e sai quando o socket esvazia", async () => {
    const { manager, ptys, time, open } = setup();
    const { terminalId } = await open();
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

  test("close com kill encerra e remove; sem kill só desanexa; o que já acabou é removido; desconhecido é not_found", async () => {
    const { manager, ptys, open } = setup();
    const first = await open();
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
    const second = await open();
    ptys.spawned[1]?.exit(0);
    manager.close(second.terminalId, false);
    expect(manager.list()).toEqual([]);
    expect(await code(() => manager.close("nada", true))).toBe("not_found");
  });

  test("o processo que termina sozinho manda terminal.exited depois da saída pendente; o terminal fica até fechar ou ficar ocioso", async () => {
    const { manager, ptys, time, open } = setup();
    const { terminalId } = await open();
    const a = fakeSink();
    manager.attach(terminalId, a);
    ptys.spawned[0]?.emit("último\r\n");
    ptys.spawned[0]?.exit(7);
    expect(a.frames.map((f) => f.type)).toEqual(["terminal.data", "terminal.exited"]);
    expect(text(a.frames)).toBe("último\r\n");
    expect(a.frames[1]).toEqual({ type: "terminal.exited", terminalId, exitCode: 7 });
    expect(manager.list()[0]).toMatchObject({ exitCode: 7, attached: 1 });
    expect(await code(() => manager.write(terminalId, "x"))).toBe("invalid_state");
    expect(await code(() => manager.resize(terminalId, 10, 10))).toBe("invalid_state");
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

  test("o log registra abrir, anexar e encerrar com id, pasta e só o programa, nunca o conteúdo nem os argumentos", async () => {
    const { manager, ptys, time, logs, project } = setup();
    const { terminalId } = await manager.open({
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

  test("stop mata todos os terminais", async () => {
    const { manager, ptys, open } = setup();
    await open();
    await open();
    manager.stop();
    expect(ptys.spawned.map((p) => p.killed)).toEqual([true, true]);
    expect(manager.list()).toEqual([]);
  });

  test("after stop no terminal opens, not even one asked for before it: nothing outlives the daemon (#1593)", async () => {
    // The first open waits on the person's Claude Code settings until the stop has run.
    const gate = Promise.withResolvers<Record<string, string>>();
    const asked = Promise.withResolvers<void>();
    const { manager, ptys, open } = setup({
      claudeEnv: () => {
        asked.resolve();
        return gate.promise;
      },
    });
    const inFlight = code(open);
    await asked.promise;
    manager.stop();
    gate.resolve({});
    expect([await inFlight, await code(open), ptys.spawned.length, manager.list()]).toEqual([
      "invalid_state",
      "invalid_state",
      0,
      [],
    ]);
  });
});
