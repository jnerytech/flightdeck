import { appendFile, mkdir, readlink as readLink, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname } from "node:path";
import { userHome } from "./config.ts";
import { type Exec, spawnExec } from "./exec.ts";
import { daemonCommand, type ServiceContext } from "./service.ts";
import { whichOnPath } from "./which.ts";

/** The OS programs that install, start or stop services. */
const CONTROLLERS = new Set(["systemctl", "schtasks", "loginctl", "systemd-run"]);

/** True for a command that would talk to the real service manager. */
export function isServiceController(cmd: string[]): boolean {
  // Both separators on every OS: posix basename keeps "C:\…\schtasks.exe" whole.
  const last = (cmd[0] ?? "").split(/[\\/]/).pop() as string;
  const name = last.toLowerCase().replace(/\.exe$/, "");
  return CONTROLLERS.has(name);
}

/**
 * Tests set `FLIGHTDECK_SERVICE_GUARD` to a file: service commands are then recorded there and
 * never run (the preload fails the suite if any was attempted).
 */
const guardedExec: typeof spawnExec = async (cmd) => {
  const guard = process.env.FLIGHTDECK_SERVICE_GUARD;
  if (!guard || !isServiceController(cmd)) return spawnExec(cmd);
  await appendFile(
    guard,
    `${cmd.join(" ")}
`,
  );
  return { code: 99, stdout: "" };
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
    systemRoot: env.SystemRoot ?? String.raw`C:\Windows`,
    tempDir: tmpdir(),
    dryRun,
    exec: guardedExec,
    async writeFile(path, content) {
      await mkdir(dirname(path), { recursive: true });
      // Task Scheduler expects the XML in UTF-16 (the declaration says so) with a BOM.
      if (path.endsWith(".xml")) await writeFile(path, `\ufeff${content}`, "utf16le");
      else await writeFile(path, content);
    },
    removeFile: (path) => rm(path, { force: true }),
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
  readlink: (path: string) => string | Promise<string> = readLink,
  exec: Exec = spawnExec,
): Promise<string | null> {
  if (platform === "win32") {
    const command = `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`;
    const { stdout } = await exec([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      command,
    ]);
    return stdout.trim() || null;
  }
  try {
    return await readlink(`/proc/${pid}/exe`);
  } catch {
    return null;
  }
}

export function killProcess(pid: number): void {
  process.kill(pid);
}
