import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../src/main.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "roots-config-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("raizes-persistencia: roots.add on a running daemon", () => {
  test("the folder is written to the config file, so it survives a restart", async () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({ hostName: "h", port: 7421, token: TOKEN, dataDir: join(dir, "data") }),
    );
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const folder = tempDir("fd-added-");
    const ack = await client.request("roots.add", { path: folder, confirm: true });
    expect(ack.ok).toBe(true);
    const saved = JSON.parse(readFileSync(file, "utf8")).allowedRoots as string[];
    expect(saved).toContain(realpathSync(folder));
  });
});
