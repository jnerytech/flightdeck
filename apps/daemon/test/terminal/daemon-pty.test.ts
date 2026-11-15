import { afterEach, describe, expect, test } from "bun:test";
import { bunPty, type SpawnFn } from "../../src/terminal/pty.ts";
import { poll } from "../support/helpers.ts";
import { teardown } from "./daemon-setup.ts";

afterEach(teardown);

describe("terminal-daemon: the Bun PTY adapter", () => {
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
    bunPty(spawn, 20, "linux")(start).kill();
    expect(signals).toEqual(["SIGHUP"]);
    await Bun.sleep(60);
    expect(signals).toEqual(["SIGHUP", "SIGKILL"]);
    // A process that ends within the grace gets nothing more.
    signals.length = 0;
    bunPty(spawn, 20, "linux")(start).kill();
    ended(129);
    await Bun.sleep(60);
    expect(signals).toEqual(["SIGHUP"]);
  });

  test("on Windows kill terminates the process as before (there is no SIGHUP), and a signal the system refuses falls back to a plain kill", async () => {
    const signals: Array<string | undefined> = [];
    const spawn: SpawnFn = () => ({
      exited: new Promise<number>(() => {}),
      terminal: { write: () => 0, resize: () => {} },
      kill: (signal) => {
        if (signal === "SIGHUP") throw new Error("Unknown signal: SIGHUP");
        signals.push(signal);
      },
    });
    const start = {
      argv: ["pwsh"],
      cwd: "C:\\w",
      env: {},
      cols: 80,
      rows: 24,
      onData: () => {},
      onExit: () => {},
    };
    const kill = (platform: NodeJS.Platform) => {
      try {
        bunPty(spawn, 20, platform)(start).kill();
        return "ok";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(kill("win32")).toBe("ok");
    expect(signals).toEqual([undefined]);
    await Bun.sleep(60);
    expect(signals).toEqual([undefined]);
    signals.length = 0;
    expect(kill("linux")).toBe("ok");
    expect(signals).toEqual([undefined]);
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
});
