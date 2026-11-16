import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Config } from "../../src/config.ts";
import {
  type ServiceContext,
  systemdUnit,
  windowsTaskXml,
} from "../../src/service/domain/install.ts";
import { stableBinPath } from "../../src/service/domain/version.ts";
import { runUpdate, type UpdateDeps } from "../../src/service/update.ts";
import { tempDir } from "../support/helpers.ts";

export const cleanups: Array<() => unknown> = [];
export async function teardown() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

/** Newer than any product version: the CLI compares the binary with the real DAEMON_VERSION. */
export const NEWER = "999.0.0";

/**
 * A file that answers `--version` like flightdeckd; `null` answers something else and `"hang"`
 * never answers in time.
 */
export function fakeBinary(version: string | null | "hang"): string {
  const dir = tempDir();
  const line = version ? `flightdeckd ${version} (protocolo 1)` : "outra coisa";
  if (process.platform === "win32") {
    const path = join(dir, "flightdeckd-novo.cmd");
    const body = version === "hang" ? "ping -n 3 127.0.0.1 >nul" : `echo ${line}`;
    writeFileSync(path, `@echo off\r\n${body}\r\n`);
    return path;
  }
  const path = join(dir, "flightdeckd-novo");
  writeFileSync(path, `#!/bin/sh\n${version === "hang" ? "sleep 2" : `echo "${line}"`}\n`);
  chmodSync(path, 0o755);
  return path;
}

/**
 * A service context that records commands and answers the query with a service installed at
 * `installed` (in our own task XML or unit format, with `config` as its --config), or with none.
 */
export function fakeService(
  platform: "win32" | "linux",
  installed: string | string[] | null,
  config: string | null = null,
) {
  const calls: string[][] = [];
  const written: Record<string, string> = {};
  const user = platform === "win32" ? "PC\\dev" : "dev";
  const ctx: ServiceContext = {
    platform,
    home: tempDir(),
    user,
    command: [],
    systemRoot: "C:\\Windows",
    tempDir: tempDir(),
    dryRun: false,
    exec: async (cmd) => {
      calls.push(cmd);
      const query = cmd[1] === "/Query" || cmd[2] === "cat";
      if (query && !installed) return { code: 1, stdout: "" };
      if (query && installed) {
        const command = typeof installed === "string" ? [installed] : installed;
        const stdout =
          platform === "win32"
            ? windowsTaskXml(command, { user, systemRoot: "C:\\Windows", config })
            : `# ${ctx.home}/.config/systemd/user/flightdeckd.service\n${systemdUnit(command, config)}`;
        return { code: 0, stdout };
      }
      return { code: 0, stdout: "" };
    },
    writeFile: (path, content) => {
      written[path] = content;
    },
    removeFile: () => {},
    which: () => null,
  };
  return { ctx, calls, written };
}

export const DIST_WIN = "D:\\repos\\flightdeck\\dist\\flightdeckd-windows-x64.exe";
export const DIST_LINUX = "/home/dev/flightdeck/dist/flightdeckd-linux-x64";

export function setup(
  platform: "win32" | "linux",
  installed: string | null,
  extra: { healthy?: boolean; running?: boolean; serviceConfig?: string } = {},
) {
  const service = fakeService(platform, installed, extra.serviceConfig ?? null);
  const stable = stableBinPath(service.ctx.home, platform);
  const settingsPath = join(tempDir(), ".claude", "settings.json");
  const out: string[] = [];
  const config = Config.parse({
    token: "t".repeat(32),
    port: 7420,
    dataDir: tempDir(),
    hooks: { port: 7421, token: "h".repeat(20) },
  });
  const healthChecks: number[] = [];
  const deps: UpdateDeps = {
    config,
    ctx: service.ctx,
    currentVersion: "0.7.0",
    settingsPath,
    stableBin: stable,
    healthy: async (port: number) => {
      healthChecks.push(port);
      return extra.healthy ?? true;
    },
    daemonRunning: () => extra.running ?? false,
    stopTimeoutMs: 50,
    versionTimeoutMs: 5_000,
    log: { log: (m: string) => out.push(m), error: (m: string) => out.push(m) },
  };
  return { ...service, stable, settingsPath, out, deps, healthChecks };
}

export const update = (deps: UpdateDeps, from: string, allowDowngrade = false) =>
  runUpdate({ from, allowDowngrade }, deps);

/** The installed binary from an earlier version. */
export function previous(stable: string) {
  mkdirSync(dirname(stable), { recursive: true });
  writeFileSync(stable, "versão antiga");
}
