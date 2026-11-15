import { describe, expect, test } from "bun:test";
import { osTempDir } from "../../../../scripts/test/temp-dir.ts";
import { createResources } from "../../src/resources/wiring.ts";
import { OLD_SESSION } from "../support/resources-wiring.ts";

describe("resources-wiring: the machine's own defaults (issue #154)", () => {
  test.skipIf(process.platform === "win32")(
    "with nothing given it reads the OS memory and the data disk, and ends an orphan with a real SIGTERM",
    async () => {
      // Windows has no `sleep`, no load average and no SIGTERM to read back.
      const child = Bun.spawn(["sleep", "30"]);
      const pid = child.pid;
      const proc = {
        pageSize: 4096,
        ticksPerSecond: 100,
        pids: async () => [42, pid],
        stat: async (p: number) =>
          p === 1
            ? { pid: 42, ppid: 0, name: "flightdeckd", cpuTicks: 0, startTicks: 0, rssPages: 1 }
            : { pid: p, ppid: 42, name: "claude", cpuTicks: 0, startTicks: 1, rssPages: 1 },
        cwd: async () => "/gone",
        uptimeSec: async () => 10_000,
      };
      const resources = await createResources({
        dataDir: osTempDir(),
        sessions: () => [OLD_SESSION],
        terminals: () => [],
        pidOf: () => null,
        ownPid: 42,
        platform: "linux",
        proc,
      });
      const snap = await resources.snapshot();
      expect(snap.memory.totalBytes).toBeGreaterThan(0);
      expect(snap.disk?.totalBytes).toBeGreaterThan(0);
      expect(snap.loadPercent).not.toBeNull();
      await resources.endOrphan(pid, 1);
      await child.exited;
      expect(child.signalCode).toBe("SIGTERM");
    },
  );
});
