import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import type { ProcReader } from "../src/resources/resources.ts";
import { tempDir } from "./helpers.ts";

setDefaultTimeout(20_000);
const TOKEN = "res-token-0123456789abcdef";
const stops: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of stops.splice(0).reverse()) await fn();
});

/** A /proc with the daemon and one claude nobody owns: nothing of the machine is read. */
const proc = (ownPid: number): ProcReader => ({
  pageSize: 4096,
  ticksPerSecond: 100,
  pids: async () => [ownPid, 90_001],
  stat: async (pid) =>
    pid === ownPid
      ? { pid, ppid: 1, name: "flightdeckd", cpuTicks: 0, startTicks: 0, rssPages: 10 }
      : { pid, ppid: ownPid, name: "claude", cpuTicks: 0, startTicks: 1, rssPages: 10 },
  cwd: async () => "/gone",
  uptimeSec: async () => 10_000,
});

describe("resources-main: a booted daemon answers resources.get", () => {
  test("it lists the sessions it has and the orphan the reader shows", async () => {
    const dir = tempDir("fd-res-main-");
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
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
      { resourcesProc: proc(process.pid) },
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
    ws.send(JSON.stringify({ id: "2", type: "resources.get", payload: {} }));
    const ack = await new Promise<protocol.Ack | undefined>((resolve) => {
      const timer = setInterval(() => {
        const found = acks.find((a) => a.id === "2");
        if (found) {
          clearInterval(timer);
          resolve(found);
        }
      }, 20);
    });
    ws.close();
    expect(ack?.ok).toBe(true);
    const snap = (ack?.ok ? ack.data : null) as protocol.ResourcesSnapshot;
    expect(snap.measured).toBe(true);
    expect(snap.orphans.map((o) => o.pid)).toEqual([90_001]);
  });
});
