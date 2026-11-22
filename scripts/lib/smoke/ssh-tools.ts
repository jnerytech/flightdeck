import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The one program that plays every fake OpenSSH tool (`scripts/test/fake-ssh-tools.ts`). */
const TOOLS = resolve(import.meta.dir, "../../test/fake-ssh-tools.ts");
const WIN = process.platform === "win32";

/**
 * Writes `ssh`, `ssh-keyscan` and, off Windows, `ssh-agent` and `ssh-add` into `bin`, each a wrapper
 * that runs the fake program in its mode. Returns the path of the `ssh` wrapper.
 */
export function installSshTools(bin: string): { ssh: string } {
  mkdirSync(bin, { recursive: true });
  const tools = ["ssh", "ssh-keyscan", ...(WIN ? [] : ["ssh-agent", "ssh-add"])];
  const mode: Record<string, string> = {
    ssh: "ssh",
    "ssh-keyscan": "keyscan",
    "ssh-agent": "agent",
    "ssh-add": "add",
  };
  for (const name of tools) {
    const call = `"${process.execPath}" "${TOOLS}" ${mode[name]}`;
    if (WIN) {
      writeFileSync(join(bin, `${name}.cmd`), `@echo off\r\n${call} %*\r\n`);
    } else {
      writeFileSync(join(bin, name), `#!/bin/sh\nexec ${call} "$@"\n`);
      chmodSync(join(bin, name), 0o755);
    }
  }
  return { ssh: join(bin, WIN ? "ssh.cmd" : "ssh") };
}
