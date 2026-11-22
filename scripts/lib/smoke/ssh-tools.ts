import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The one program that plays every fake OpenSSH tool (`scripts/test/fake-ssh-tools.ts`). */
const TOOLS = resolve(import.meta.dir, "../../test/fake-ssh-tools.ts");
const WIN = process.platform === "win32";

/** A word `sh` reads back as it is. */
const shQuote = (word: string) => `'${word.replaceAll("'", String.raw`'\''`)}'`;

/**
 * Writes `ssh`, `ssh-keyscan` and, off Windows, `ssh-agent` and `ssh-add` into `bin`, each a wrapper
 * that runs the fake program in its mode. `env` is written into each wrapper, for a caller whose process
 * environment is not the one to carry it. Returns the path of the `ssh` wrapper.
 */
export function installSshTools(bin: string, env: Record<string, string> = {}): { ssh: string } {
  mkdirSync(bin, { recursive: true });
  const tools = ["ssh", "ssh-keyscan", ...(WIN ? [] : ["ssh-agent", "ssh-add"])];
  const mode: Record<string, string> = {
    ssh: "ssh",
    "ssh-keyscan": "keyscan",
    "ssh-agent": "agent",
    "ssh-add": "add",
  };
  const entries = Object.entries(env);
  for (const name of tools) {
    const call = `"${process.execPath}" "${TOOLS}" ${mode[name]}`;
    if (WIN) {
      const sets = entries.map(([key, value]) => `set "${key}=${value}"\r\n`).join("");
      writeFileSync(join(bin, `${name}.cmd`), `@echo off\r\n${sets}${call} %*\r\n`);
    } else {
      const exports = entries.map(([key, value]) => `export ${key}=${shQuote(value)}\n`).join("");
      writeFileSync(join(bin, name), `#!/bin/sh\n${exports}exec ${call} "$@"\n`);
      chmodSync(join(bin, name), 0o755);
    }
  }
  return { ssh: join(bin, WIN ? "ssh.cmd" : "ssh") };
}
