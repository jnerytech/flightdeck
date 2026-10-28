import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname } from "node:path";
import { spawnExec } from "./exec.ts";
import { daemonCommand, type ServiceContext } from "./service.ts";
import { whichOnPath } from "./which.ts";

/** The real `ServiceContext`; `overrides` only exist so tests can exercise the Windows branch. */
export function osServiceContext(
  dryRun: boolean,
  overrides: { platform?: string; env?: Record<string, string | undefined> } = {},
): ServiceContext {
  const platform = overrides.platform ?? process.platform;
  const env = overrides.env ?? process.env;
  return {
    platform,
    home: homedir(),
    user: platform === "win32" ? `${env.USERDOMAIN}\\${env.USERNAME}` : userInfo().username,
    command: daemonCommand(process.execPath, Bun.main),
    systemRoot: env.SystemRoot ?? "C:\\Windows",
    tempDir: tmpdir(),
    dryRun,
    exec: spawnExec,
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
