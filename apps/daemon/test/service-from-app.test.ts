import { describe, expect, test } from "bun:test";
import type { ServiceContext } from "../src/service.ts";
import { installService } from "../src/service.ts";
import { appCanInstallService, installServiceFromApp } from "../src/service-from-app.ts";

const STABLE_LINUX = "/home/dev/.flightdeck/bin/flightdeckd";
const STABLE_WIN = "C:\\Users\\dev\\.flightdeck\\bin\\flightdeckd.exe";

/** A service manager that records what it is asked and touches nothing. */
function fake(
  platform: "linux" | "win32" | "darwin",
  opts: { linger?: "yes" | "no"; systemctl?: boolean } = {},
) {
  const calls: string[][] = [];
  const written = new Map<string, string>();
  const which: Record<string, string> = {
    claude: platform === "win32" ? "C:\\npm\\claude.exe" : "/usr/local/bin/claude",
    "claude.exe": "C:\\npm\\claude.exe",
    schtasks: "C:\\Windows\\System32\\schtasks.exe",
  };
  if (opts.systemctl !== false) which.systemctl = "/usr/bin/systemctl";
  const ctx: ServiceContext = {
    platform,
    home: platform === "win32" ? "C:\\Users\\dev" : "/home/dev",
    user: platform === "win32" ? "PC\\dev" : "dev",
    command: [platform === "win32" ? STABLE_WIN : STABLE_LINUX],
    systemRoot: "C:\\Windows",
    tempDir: platform === "win32" ? "C:\\Temp" : "/tmp",
    dryRun: false,
    exec: async (cmd) => {
      calls.push(cmd);
      if (cmd[0] === "loginctl") return { code: 0, stdout: `Linger=${opts.linger ?? "yes"}\n` };
      return { code: 0, stdout: "" };
    },
    writeFile: (path, content) => {
      written.set(path, content);
    },
    removeFile: () => {},
    which: (name) => which[name] ?? null,
  };
  const recorded: string[] = [];
  const deps = {
    ctx,
    config: null,
    recordClaude: async (path: string) => {
      recorded.push(path);
    },
  };
  return { deps, calls, written, recorded };
}

const line = (calls: string[][]) => calls.map((c) => c.join(" "));

/** The refusal reason a call ends with, or "resolved" when it does not throw. */
async function reasonOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "resolved";
  } catch (error) {
    return (error as { reason?: string }).reason ?? String(error);
  }
}

describe("service from the app (#1200)", () => {
  test("only the stable binary on Linux or Windows may install itself; never a daemon run from source", () => {
    expect(appCanInstallService([STABLE_LINUX], STABLE_LINUX, "linux")).toBe(true);
    expect(appCanInstallService([STABLE_WIN], STABLE_WIN, "win32")).toBe(true);
    expect(
      appCanInstallService(["/usr/bin/bun", "run", "/repo/main.ts"], STABLE_LINUX, "linux"),
    ).toBe(false);
    expect(appCanInstallService(["/tmp/flightdeckd"], STABLE_LINUX, "linux")).toBe(false);
    expect(appCanInstallService([STABLE_LINUX], STABLE_LINUX, "darwin")).toBe(false);
  });

  test("the CLI's install keeps starting the service; with start: false it is enabled for the next boot", async () => {
    const now = fake("linux");
    await installService(now.deps.ctx, null);
    expect(line(now.calls)).toContain("systemctl --user enable --now flightdeckd");
    const later = fake("linux");
    await installService(later.deps.ctx, null, { start: false });
    expect(line(later.calls)).toContain("systemctl --user enable flightdeckd");
    expect(line(later.calls).filter((c) => c.includes("--now"))).toEqual([]);
  });

  test("on Linux the unit is written and enabled, not started, and the service's claude is recorded", async () => {
    const os = fake("linux");
    const result = await installServiceFromApp(os.deps, true);
    expect([...os.written.keys()]).toEqual(["/home/dev/.config/systemd/user/flightdeckd.service"]);
    expect(line(os.calls)).toContain("systemctl --user enable flightdeckd");
    expect(line(os.calls).filter((c) => c.includes("--now") || c.includes(" start"))).toEqual([]);
    expect(os.recorded).toEqual(["/usr/local/bin/claude"]);
    expect(result).toEqual({ startsAt: "boot", lingerOff: false, user: "dev" });
  });

  test("with linger off it starts at the next login, and the app is told so (it never runs sudo)", async () => {
    const os = fake("linux", { linger: "no" });
    const result = await installServiceFromApp(os.deps, true);
    expect(result).toEqual({ startsAt: "logon", lingerOff: true, user: "dev" });
    expect(line(os.calls).filter((c) => c.includes("sudo") || c.includes("enable-linger"))).toEqual(
      [],
    );
  });

  test("on Windows the logon task is created and not run now", async () => {
    const os = fake("win32");
    const result = await installServiceFromApp(os.deps, true);
    expect(line(os.calls).some((c) => c.startsWith("schtasks /Create"))).toBe(true);
    expect(line(os.calls).filter((c) => c.includes("/Run"))).toEqual([]);
    expect(os.recorded).toEqual(["C:\\npm\\claude.exe"]);
    expect(result).toEqual({ startsAt: "logon", lingerOff: false, user: "PC\\dev" });
  });

  test("it is refused, with a reason and before touching anything, without confirm, on macOS, or with no systemd", async () => {
    const cases: [string, ReturnType<typeof fake>, boolean][] = [
      ["no confirm", fake("linux"), false],
      ["macOS", fake("darwin"), true],
      ["no systemd", fake("linux", { systemctl: false }), true],
    ];
    const seen: string[] = [];
    for (const [name, os, confirm] of cases) {
      const reason = await reasonOf(() => installServiceFromApp(os.deps, confirm));
      seen.push(`${name}: ${reason}, wrote ${os.written.size}, ran ${os.calls.length}`);
    }
    expect(seen).toEqual([
      "no confirm: service_confirm, wrote 0, ran 0",
      "macOS: service_unsupported, wrote 0, ran 0",
      "no systemd: service_unsupported, wrote 0, ran 0",
    ]);
  });
});
