import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { startDaemon } from "../src/main.ts";
import { poll, tempDir } from "./helpers.ts";

const TOKEN = "deps-guard-token-0123456789abcdef";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/** What the sentinels (the stand-ins for the real claude, gh and az, first on PATH) recorded so far. */
function sentinelCalls(): string[] {
  const dirs = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((dir) => /fd-(claude|cli)-guard-/.test(dir));
  return dirs.flatMap((dir) => {
    const log = join(dir, "calls.log");
    return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  });
}

/** The `--version` probes the sentinels answered (they keep them apart from the real uses in calls.log). */
function sentinelProbes(): string[] {
  const dirs = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((dir) => /fd-(claude|cli)-guard-/.test(dir));
  return dirs.flatMap((dir) => {
    const log = join(dir, "versions.log");
    return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  });
}

describe("deps-guard: a plain daemon asked for its dependencies runs no real program", () => {
  test("startDaemon, a connection and deps.check reach no claude, gh or az", async () => {
    expect((process.env.PATH ?? "").split(delimiter).some((d) => /fd-claude-guard-/.test(d))).toBe(
      true,
    );
    const before = sentinelCalls();
    const probesBefore = sentinelProbes().length;
    // Nothing real is run for the other programs either: stand-ins that record what they are asked.
    const others = ["git", "ssh", "tailscale", "pwsh"].map((name) => {
      const fake = installFakeCli(name, [{ args: ["--version"], stdout: `${name} 9.9.9` }]);
      stops.push(async () => fake.restore());
      return { name, fake };
    });
    const dir = tempDir("fd-deps-guard-");
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        hostName: "h",
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [dir],
      }),
    );
    // The service manager is the one thing this test stands in for: nothing real is asked of it.
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
      { serviceInstalled: async () => true, linger: async () => "on" },
    );
    stops.push(() => daemon.stop());
    const ws = new WebSocket(daemon.url);
    const acks: protocol.Ack[] = [];
    ws.addEventListener("message", (m) => {
      const msg = protocol.parseServerMessage(String(m.data));
      if (msg.type === "ack") acks.push(msg);
    });
    await new Promise((r) => ws.addEventListener("open", r));
    ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
    ws.send(JSON.stringify({ id: "2", type: "deps.check", payload: {} }));
    const ack = await poll(() => acks.find((a) => a.id === "2"), 8000);
    ws.close();
    expect(ack?.ok).toBe(true);
    // The probe ran, and what it asked is answered by the stand-ins, which keep no record of it.
    const items = ((ack?.ok ? ack.data : null) as protocol.DepsResult).items;
    expect(items.find((i) => i.id === "claude")?.path).toContain("fd-claude-guard-");
    expect(sentinelCalls()).toEqual(before);
    // The guard still sees the probes: claude, gh and az were each asked for their version, and only that.
    const probes = sentinelProbes().slice(probesBefore);
    for (const name of ["claude", "gh", "az"]) expect(probes).toContain(`${name} --version`);
    // The other programs found on the PATH are the stand-ins, asked for nothing but a version.
    for (const { name, fake } of others) {
      if (name === "pwsh" && process.platform !== "win32") continue;
      expect(fake.calls().length).toBeGreaterThan(0);
      for (const call of fake.calls()) expect(call).toHaveLength(1);
    }
  });
});
