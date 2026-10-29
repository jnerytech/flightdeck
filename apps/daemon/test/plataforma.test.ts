import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { realTempDir, testHome } from "../../../scripts/test/temp-dir.ts";
import { Config, defaultConfigPath, expandHome, userHome } from "../src/config.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import type { RuntimeEvent } from "../src/runtime/types.ts";
import { osServiceContext, processPath } from "../src/service-os.ts";
import { stopServiceDaemon } from "../src/update.ts";

describe("plataforma", () => {
  test("o home vem do ambiente na hora da chamada: HOME, ou USERPROFILE no Windows", () => {
    // Bun's os.homedir() on Linux keeps the HOME the process started with; Node reads it on
    // every call. The daemon follows the environment, as Node does.
    expect(userHome({ HOME: "/home/x", USERPROFILE: "C:\\Users\\y" }, "linux")).toBe("/home/x");
    expect(userHome({ HOME: "/c/x", USERPROFILE: "C:\\Users\\y" }, "win32")).toBe("C:\\Users\\y");
    expect(userHome({}, "linux")).toBe(homedir());
    expect(userHome({ HOME: "" }, "linux")).toBe(homedir());
  });

  test("expandHome, a config padrão e o contexto do serviço usam o home do ambiente", () => {
    const home = testHome();
    expect(userHome()).toBe(home);
    expect(expandHome("~")).toBe(home);
    expect(expandHome("~/a")).toBe(join(home, "a"));
    expect(defaultConfigPath()).toBe(join(home, ".flightdeck", "config.json"));
    expect(osServiceContext(true).home).toBe(home);
  });

  test("a duração do turno do FakeRuntime não fica negativa se o relógio do sistema voltar", async () => {
    // A WSL or container clock that syncs backwards in the middle of a turn.
    let wall = 1_000_000;
    const clock = spyOn(Date, "now").mockImplementation(() => {
      wall -= 1_000;
      return wall;
    });
    try {
      const run = new FakeRuntime({ delayMs: 0 }).start({
        cwd: "/x",
        permissionMode: "default",
        env: {},
        canUseTool: async () => ({ behavior: "allow" }),
      });
      const events = run.events[Symbol.asyncIterator]();
      run.send("olá");
      let result: RuntimeEvent | undefined;
      while (!result) {
        const { value, done } = await events.next();
        if (done) break;
        if (value.type === "turn.result") result = value;
      }
      expect(result?.type === "turn.result" && result.durationMs).toBeGreaterThanOrEqual(0);
      await run.close();
    } finally {
      clock.mockRestore();
    }
  });

  test.skipIf(process.platform !== "win32")(
    "parar o daemon: o caminho 8.3 do serviço e o longo do processo são o mesmo executável",
    async () => {
      const dir = join(realTempDir("fd-plataforma-"), "executavel-com-nome-bem-longo");
      mkdirSync(dir);
      const exe = join(dir, "flightdeckd.exe");
      writeFileSync(exe, "");
      // How a task registered from an 8.3 TEMP names the daemon (C:\Users\RUNNER~1\...).
      const short = Bun.spawnSync(
        [
          "powershell.exe",
          "-NoProfile",
          "-Command",
          "(New-Object -ComObject Scripting.FileSystemObject).GetFile($env:FD_EXE).ShortPath",
        ],
        { env: { ...process.env, FD_EXE: exe } },
      )
        .stdout.toString()
        .trim();
      expect(short).not.toBe(exe);
      const killed: number[] = [];
      const stopped = await stopServiceDaemon(
        {
          ctx: { ...osServiceContext(false), exec: async () => ({ code: 0, stdout: "" }) },
          daemonRunning: () => killed.length === 0,
          lockPid: () => 4242,
          processPath: async () => exe,
          kill: (pid) => {
            killed.push(pid);
          },
          stopTimeoutMs: 10,
          log: { log: () => {}, error: () => {} },
        },
        Config.parse({ token: "t".repeat(32), dataDir: realTempDir("fd-plataforma-") }),
        short,
      );
      expect(killed).toEqual([4242]);
      expect(stopped).toBe(true);
    },
  );

  test("no Windows, o executável do processo vem do Get-Process do PowerShell", async () => {
    const calls: string[][] = [];
    const exec = async (cmd: string[]) => {
      calls.push(cmd);
      return { code: 0, stdout: "C:\\fd\\flightdeckd.exe\r\n" };
    };
    const read = () => "nunca";
    expect(await processPath(42, "win32", read, exec)).toBe("C:\\fd\\flightdeckd.exe");
    expect(calls[0]?.at(-1)).toBe("(Get-Process -Id 42 -ErrorAction SilentlyContinue).Path");
    const gone = async () => ({ code: 0, stdout: "" });
    expect(await processPath(42, "win32", read, gone)).toBeNull();
  });

  test("um ~ fora do começo do caminho não é o home", () => {
    for (const path of ["C:\\Users\\RUNNER~1\\x", "/tmp/a~b", "a~", "~user/x"]) {
      expect(expandHome(path)).toBe(path);
    }
  });
});
