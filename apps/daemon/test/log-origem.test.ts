import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { FileLog } from "../src/logs/file-log.ts";
import { logPathFor, tailForOrigin } from "../src/logs/serve.ts";
import { tempDir } from "./helpers.ts";

const make = async () => {
  const log = new FileLog({
    dir: join(tempDir("fd-logorg-"), "logs"),
    scanner: new SecretScanner(),
  });
  log.write("info", "a line");
  await log.flush();
  return log;
};

describe("log-origem: the log is for loopback and Tailscale, like the vault (issue #255)", () => {
  test("a connection from loopback or Tailscale reads the tail and the path", async () => {
    const log = await make();
    for (const origin of ["127.0.0.1", "::1", "100.64.1.2"]) {
      const out = await tailForOrigin(log, origin, 10);
      expect(out.lines.join("\n")).toContain("a line");
      expect(out.path).toBe(log.path());
      expect(logPathFor(log, origin)).toEqual({ logPath: log.path() });
    }
  });

  test("any other origin is refused with the transport reason, says so in the daemon's log, and learns no path", async () => {
    const log = await make();
    const said: string[] = [];
    for (const origin of ["8.8.8.8", "192.168.1.20", ""]) {
      await expect(tailForOrigin(log, origin, 10, (m) => void said.push(m))).rejects.toMatchObject({
        code: "invalid_state",
        reason: "transport_refused",
      });
      expect(logPathFor(log, origin)).toEqual({});
    }
    expect(said).toHaveLength(3);
    expect(said[0]).toContain("logs.tail");
  });
});
