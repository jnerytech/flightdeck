import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The one program that plays every fake OpenSSH tool (`scripts/test/fake-ssh-tools.ts`). */
const TOOLS = resolve(import.meta.dirname, "../../test/fake-ssh-tools.ts");
const WIN = process.platform === "win32";

/** A word `sh` reads back as it is. */
const shQuote = (word: string) => `'${word.replaceAll("'", String.raw`'\''`)}'`;

/** The text of a Windows wrapper: `set` lines for `entries`, then `call` with the arguments passed on. */
export function cmdWrapper(call: string, entries: Array<[string, string]>): string {
  const sets = entries.map(([key, value]) => `set "${key}=${value}"\r\n`).join("");
  return `@echo off\r\n${sets}${call} %*\r\n`;
}

/** The text of a POSIX wrapper: `export` lines for `entries`, then `call` with the arguments passed on. */
export function shWrapper(call: string, entries: Array<[string, string]>): string {
  const exports = entries.map(([key, value]) => `export ${key}=${shQuote(value)}\n`).join("");
  return `#!/bin/sh\n${exports}exec ${call} "$@"\n`;
}

/**
 * Writes `ssh`, `ssh-keyscan` and, off Windows unless `agent` is false, `ssh-agent` and `ssh-add` into `bin`, each a wrapper
 * that runs the fake program in its mode. `options.env` is written into each wrapper, for a caller whose process
 * environment is not the one to carry it. Returns the path of the `ssh` wrapper.
 */
export function installSshTools(
  bin: string,
  options: { env?: Record<string, string>; agent?: boolean } = {},
): { ssh: string } {
  const { env = {}, agent = true } = options;
  mkdirSync(bin, { recursive: true });
  const tools = ["ssh", "ssh-keyscan", ...(WIN || !agent ? [] : ["ssh-agent", "ssh-add"])];
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
      writeFileSync(join(bin, `${name}.cmd`), cmdWrapper(call, entries));
    } else {
      writeFileSync(join(bin, name), shWrapper(call, entries));
      chmodSync(join(bin, name), 0o755);
    }
  }
  return { ssh: join(bin, WIN ? "ssh.cmd" : "ssh") };
}
