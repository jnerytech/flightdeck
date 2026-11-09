import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../src/main.ts";
import { poll, tempDir } from "./helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("conn-close-log: the started daemon writes the line to its own log (issue #1532)", () => {
  test("a client that says hello and leaves is in the daemon's log, without the token", async () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    const token = "main-close-token-0123456789ab";
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token,
        dataDir: join(dir, "data"),
        allowedRoots: [dir],
        runtime: "fake",
      }),
    );
    const lines: string[] = [];
    const running = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: (m) => lines.push(m), error: () => {} },
      {},
    );
    cleanups.push(() => running.stop());
    const ws = new WebSocket(running.url);
    cleanups.push(() => ws.close());
    let acked = false;
    ws.addEventListener("message", () => {
      acked = true;
    });
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({ id: "h", type: "hello", payload: { token, client: "probe" } })),
    );
    expect(await poll(() => acked)).toBe(true);
    ws.close(1000, "bye");
    const closed = await poll(() => lines.find((line) => line.includes("closed: client")));
    expect(closed).toMatch(/^connection #\d+ closed: client "probe", code 1000 "bye", by the peer/);
    expect(lines.join("\n")).not.toContain(token);
  });
});
