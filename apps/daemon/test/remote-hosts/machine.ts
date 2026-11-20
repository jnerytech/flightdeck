/** A test machine with the app's name index, a credential helper beside the binary, and a fake helper process. */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_IDENTIFIER } from "../../src/remote-hosts/domain/paths.ts";
import type { ResolveDeps } from "../../src/remote-hosts/resolve.ts";
import { tempDir } from "../support/helpers.ts";

export const A = "0b9f3c2e-4f4a-4c53-9d0b-6a7d1e5c8f10";
export const B = "7c1d9e44-2a6b-4e0f-8b35-3f9a6d2c1e07";
export const TOKEN = "tok-AbCdEf0123456789-secret-value";
export const me = process.getuid?.() ?? null;

export interface Setup {
  hosts?: { id: string; name: string }[] | null;
  helper?: boolean;
  url?: string;
  helperCode?: number;
  /** What the fake helper prints for `get`. */
  token?: string;
}

/** A machine with the app's index, a helper beside the binary, and a fake helper that answers for host A. */
export function machine(setup: Setup = {}) {
  const home = tempDir("fd-resolve-home-");
  const config = join(home, "config");
  const bin = join(home, "bin");
  mkdirSync(bin);
  chmodSync(bin, 0o755);
  if (setup.hosts !== null) {
    mkdirSync(join(config, APP_IDENTIFIER), { recursive: true });
    const index = join(config, APP_IDENTIFIER, "hosts.json");
    writeFileSync(index, JSON.stringify({ hosts: setup.hosts ?? [{ id: A, name: "server" }] }));
    chmodSync(index, 0o600);
  }
  if (setup.helper !== false) {
    writeFileSync(join(bin, "flightdeck-cred"), "#!/bin/sh\n");
    chmodSync(join(bin, "flightdeck-cred"), 0o755);
  }
  const calls: string[][] = [];
  const deps: ResolveDeps = {
    env: { platform: "linux", home, xdgConfigHome: config, execPath: join(bin, "flightdeckd") },
    uid: me,
    exec: async (cmd) => {
      calls.push(cmd);
      const stdout =
        cmd[1] === "get"
          ? `${setup.token ?? TOKEN}\n`
          : `${setup.url ?? "wss://server.example.com/v1/ws"}\n`;
      return { code: setup.helperCode ?? 0, stdout };
    },
  };
  return { deps, calls };
}
