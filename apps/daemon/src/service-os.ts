import { appendFileSync, mkdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { basename, dirname } from "node:path";
import { userHome } from "./config.ts";
import { spawnExec } from "./exec.ts";
import { daemonCommand, type ServiceContext } from "./service.ts";
import { whichOnPath } from "./which.ts";

/** The OS programs that install, start or stop services. */
const CONTROLLERS = new Set(["systemctl", "schtasks", "loginctl"]);

/** True for a command that would talk to the real service manager. */
export function isServiceController(cmd: string[]): boolean {
  const name = basename(cmd[0] ?? "")
    .toLowerCase()
    .replace(/.exe$/, "");
  return CONTROLLERS.has(name);
}

/**
 * Tests set `FLIGHTDECK_SERVICE_GUARD` to a file: service commands are then recorded there and
 * never run (the preload fails the suite if any was attempted).
 */
const guardedExec: typeof spawnExec = (cmd) => {
  const guard = process.env.FLIGHTDECK_SERVICE_GUARD;
  if (!guard || !isServiceController(cmd)) return spawnExec(cmd);
  appendFileSync(
    guard,
    `${cmd.join(" ")}
`,
  );
  return Promise.resolve({ code: 99, stdout: "" });
};

/** The real `ServiceContext`; `overrides` only exist so tests can exercise the Windows branch. */
export function osServiceContext(
  dryRun: boolean,
  overrides: { platform?: string; env?: Record<string, string | undefined> } = {},
): ServiceContext {
  const platform = overrides.platform ?? process.platform;
  const env = overrides.env ?? process.env;
  return {
    platform,
    home: userHome(),
    user: platform === "win32" ? `${env.USERDOMAIN}\\${env.USERNAME}` : userInfo().username,
    command: daemonCommand(process.execPath, Bun.main),
    systemRoot: env.SystemRoot ?? "C:\\Windows",
    tempDir: tmpdir(),
    dryRun,
    exec: guardedExec,
    writeFile(path, content) {
      mkdirSync(dirname(path), { recursive: true });
      // Task Scheduler expects the XML in UTF-16 (the declaration says so) with a BOM.
      if (path.endsWith(".xml")) writeFileSync(path, `\ufeff${content}`, "utf16le");
      else writeFileSync(path, content);
    },
    removeFile: (path) => rmSync(path, { force: true }),
    which: whichOnPath,
  };
}

/**
 * The executable of a running process, or null when it is gone or cannot be read: PowerShell
 * on Windows, `/proc/<pid>/exe` elsewhere.
 */
export async function processPath(
  pid: number,
  platform: string = process.platform,
  readlink: (path: string) => string = readlinkSync,
): Promise<string | null> {
  if (platform === "win32") {
    const command = `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`;
    const { stdout } = await spawnExec([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      command,
    ]);
    return stdout.trim() || null;
  }
  try {
    return readlink(`/proc/${pid}/exe`);
  } catch {
    return null;
  }
}

export function killProcess(pid: number): void {
  process.kill(pid);
}
