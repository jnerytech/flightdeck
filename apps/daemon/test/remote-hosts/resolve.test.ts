import { describe, expect, test } from "bun:test";
import { type ResolveDeps, resolveHost } from "../../src/remote-hosts/resolve.ts";
import { A, B, machine, me, type Setup, TOKEN } from "./machine.ts";

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
