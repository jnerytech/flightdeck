import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_IDENTIFIER } from "../../src/remote-hosts/domain/paths.ts";
import { type ResolveDeps, resolveHost } from "../../src/remote-hosts/resolve.ts";
import { tempDir } from "../support/helpers.ts";

const A = "0b9f3c2e-4f4a-4c53-9d0b-6a7d1e5c8f10";
const B = "7c1d9e44-2a6b-4e0f-8b35-3f9a6d2c1e07";
const TOKEN = "tok-AbCdEf0123456789-secret-value";
const me = process.getuid?.() ?? null;

interface Setup {
  hosts?: { id: string; name: string }[] | null;
  helper?: boolean;
  url?: string;
  helperCode?: number;
}

/** A machine with the app's index, a helper beside the binary, and a fake helper that answers for host A. */
function machine(setup: Setup = {}) {
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
        cmd[1] === "get" ? `${TOKEN}\n` : `${setup.url ?? "wss://server.example.com/v1/ws"}\n`;
      return { code: setup.helperCode ?? 0, stdout };
    },
  };
  return { deps, calls };
}

const refused = async (name: string, setup: Setup = {}) => {
  const m = machine(setup);
  const got = await resolveHost(name, m.deps);
  if (got.ok) throw new Error(`expected a refusal, got a target for ${got.target.name}`);
  return { ...got.result, calls: m.calls };
};

describe.skipIf(me === null)(
  "--host: a name becomes a host to ask, or a stable refusal (#3429)",
  () => {
    test("a known name gives the address and the token, read through the helper", async () => {
      const m = machine();
      const got = await resolveHost("server", m.deps);
      if (!got.ok) throw new Error(`refused: ${got.result.err.join(" ")}`);
      expect({ name: got.target.name, url: got.target.url, token: got.target.token() }).toEqual({
        name: "server",
        url: "wss://server.example.com/v1/ws",
        token: TOKEN,
      });
      expect(m.calls.map((cmd) => cmd.slice(1))).toEqual([
        ["get", "--", A],
        ["url", "--", A],
      ]);
    });

    test("an unknown name is exit 1 with its reason and the names that exist", async () => {
      const got = await refused("sever", {
        hosts: [
          { id: A, name: "server" },
          { id: B, name: "laptop" },
        ],
      });
      expect({ code: got.code, reason: got.reason, err: got.err.join(" ") }).toEqual({
        code: 1,
        reason: "unknown_host",
        err: expect.stringContaining("laptop, server"),
      });
      expect(got.calls).toEqual([]);
    });

    test("two hosts with one name are ambiguous, and nothing is asked of the helper", async () => {
      const got = await refused("server", {
        hosts: [
          { id: A, name: "server" },
          { id: B, name: "server" },
        ],
      });
      expect({ code: got.code, reason: got.reason }).toEqual({ code: 1, reason: "ambiguous_host" });
      expect(got.calls).toEqual([]);
    });

    test("an address typed as the name is just an unknown name: it is never dialled", async () => {
      for (const typed of ["ws://10.0.0.5:7420/v1/ws", "10.0.0.5", "server.example.com"]) {
        const got = await refused(typed);
        expect({ typed, reason: got.reason, calls: got.calls }).toEqual({
          typed,
          reason: "unknown_host",
          calls: [],
        });
      }
    });

    test("no index, or no helper, is `no credential store` and points at the app", async () => {
      for (const setup of [{ hosts: null }, { helper: false }, { helperCode: 1 }] as Setup[]) {
        const got = await refused("server", setup);
        expect({ setup, code: got.code, reason: got.reason, err: got.err.join(" ") }).toEqual({
          setup,
          code: 1,
          reason: "no_store",
          err: expect.stringContaining("no credential store: pair from the app"),
        });
      }
    });

    test("a plain ws address on the open internet is refused, and the token is not in what is printed", async () => {
      const got = await refused("server", { url: "ws://server.example.com/v1/ws" });
      expect({ code: got.code, reason: got.reason }).toEqual({
        code: 1,
        reason: "cleartext_remote",
      });
      expect(JSON.stringify(got)).not.toContain(TOKEN);
    });

    test("a ws address on a private network is allowed, and an address with a user or a path is bad_address", async () => {
      const ok = await resolveHost("server", machine({ url: "ws://100.64.1.2:7420/v1/ws" }).deps);
      expect(ok.ok).toBe(true);
      const bad = await refused("server", { url: "wss://user:pw@server.example.com/v1/ws" });
      expect({ code: bad.code, reason: bad.reason }).toEqual({ code: 1, reason: "bad_address" });
      expect(JSON.stringify(bad)).not.toContain("pw@");
    });

    test("the name a person typed cannot drive the terminal in the message", async () => {
      const got = await refused("\u001b[2Jserver");
      expect(got.err.join(" ")).toContain("server");
    expect(got.err.join(" ")).not.toContain("\u001b");
    });
  },
);
