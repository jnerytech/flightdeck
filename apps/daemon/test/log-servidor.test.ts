import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as protocol from "@flightdeck/protocol";
import { SecretScanner } from "@flightdeck/protocol";
import { FileLog } from "../src/logs/file-log.ts";
import { startDaemon } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(20_000);
const TOKEN = "logs-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function serve(withLog = true) {
  const ctx = newManager();
  const dir = join(tempDir("fd-logsrv-"), "logs");
  const fileLog = new FileLog({ dir, scanner: new SecretScanner() });
  fileLog.write("info", "first line");
  fileLog.write("error", "second line with token=0123456789abcdef0123456789abcdef");
  const server = startServer({
    manager: ctx.manager,
    ...(withLog ? { fileLog } : {}),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { client, fileLog };
}

describe("log-servidor: the log over the protocol (issue #255)", () => {
  test("host.info names the log and announces logs; a host without one does neither", async () => {
    const on = await serve();
    const info = await on.client.data<protocol.HostInfoResult>("host.info", {});
    expect(info?.features).toContain("logs");
    expect(info?.logPath).toBe(on.fileLog.path());
    const off = await serve(false);
    const bare = await off.client.data<protocol.HostInfoResult>("host.info", {});
    expect(bare?.features).not.toContain("logs");
    expect(bare?.logPath).toBeUndefined();
  });

  test("logs.tail answers the last lines, redacted, and the path", async () => {
    const { client, fileLog } = await serve();
    const answer = await client.data<protocol.LogTail>("logs.tail", { lines: 10 });
    expect(answer?.path).toBe(fileLog.path());
    expect(answer?.lines).toHaveLength(2);
    expect(answer?.lines.join("\n")).not.toContain("0123456789abcdef0123456789abcdef");
    expect(answer?.lines[1]).toContain("second line");
    const all = await client.data<protocol.LogTail>("logs.tail", {});
    expect(all?.lines).toHaveLength(2);
  });

  test("the request is bounded: 0, 501 and an extra key are refused; without a log it is off", async () => {
    const { client } = await serve();
    for (const payload of [{ lines: 0 }, { lines: 501 }, { lines: 1.5 }, { extra: true }]) {
      expect((await client.request("logs.tail", payload)).ok).toBe(false);
    }
    const off = await serve(false);
    expect((await off.client.request("logs.tail", {})).ok).toBe(false);
  });
});

describe("log-servidor: a booted daemon logs to a file", () => {
  test("what the daemon says goes to the log folder it is given, and logs.tail reads it", async () => {
    const dir = tempDir("fd-logmain-");
    const file = join(dir, "config.json");
    mkdirSync(join(dir, "proj"), { recursive: true });
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
    const logDir = join(dir, "logs");
    const said: string[] = [];
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: (m) => void said.push(m), error: (m) => void said.push(m) },
      { logDir },
    );
    cleanups.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const written = readFileSync(join(logDir, "flightdeckd.log"), "utf8");
    expect(written).toContain("listening on");
    // The console still gets it too.
    expect(said.join("\n")).toContain("listening on");
    const tail = await client.data<protocol.LogTail>("logs.tail", { lines: 50 });
    expect(tail?.lines.join("\n")).toContain("listening on");
    const info = await client.data<protocol.HostInfoResult>("host.info", {});
    expect(info?.logPath).toBe(join(logDir, "flightdeckd.log"));
  });
});
