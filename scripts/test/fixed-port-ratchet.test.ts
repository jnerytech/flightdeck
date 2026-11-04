import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { fixedPortCounts, fixedPortUses } from "../lib/fixed-port-ratchet.ts";

const root = resolve(import.meta.dir, "../..");

describe("portas-fixas: a server in a test never asks for a port of the real daemon", () => {
  test("a config written for a started daemon, or a server's own options, with 742x is a use", () => {
    const daemon = [
      'import { startDaemon } from "../src/main.ts";',
      'writeFileSync(file, JSON.stringify({ hostName: "h", port: 7421, token }));',
      'await startDaemon({ command: "start", config: file }, {}, log);',
    ].join("\n");
    expect(fixedPortUses(daemon)).toBe(1);
    expect(
      fixedPortUses("const s = startServer({ manager, bind: '127.0.0.1', port: 7420 });"),
    ).toBe(1);
    expect(fixedPortUses("Bun.serve({ hostname: '127.0.0.1', port: 7425, fetch })")).toBe(1);
    expect(fixedPortUses("server.listen(7422)")).toBe(1);
  });

  test("port 0, other ports, and data that only mentions 742x are not uses", () => {
    expect(fixedPortUses("startServer({ bind: '127.0.0.1', port: 0 })")).toBe(0);
    expect(fixedPortUses("Bun.serve({ port: 9000, fetch })")).toBe(0);
    // A pure function over a port, a pairing link and a message are data, not a server.
    expect(fixedPortUses('expect(daemonUrl({ bind: "127.0.0.1", port: 7420 })).toBe("x")')).toBe(0);
    expect(fixedPortUses('formatPairingLink({ address: "1.2.3.4", port: 7421, name: "n" })')).toBe(
      0,
    );
    expect(fixedPortUses("JSON.stringify({ port: 7421 }) // no daemon started in this file")).toBe(
      0,
    );
  });

  test("no test of the repository starts a server on a fixed port of the real daemon", () => {
    expect(fixedPortCounts(root)).toEqual({});
  });
});
