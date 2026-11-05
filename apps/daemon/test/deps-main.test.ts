import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { startDaemon } from "../src/main.ts";
import { poll, tempDir } from "./helpers.ts";

const TOKEN = "deps-main-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("deps-main: the running daemon looks for the programs on its own PATH", () => {
  test("deps.check finds each program, reads its version and reports a missing one, with no real program run", async () => {
    // Fakes first on PATH answer `--version`; claude is the one a real host cannot do without.
    for (const name of ["claude", "git", "gh", "az", "ssh", "tailscale"]) {
      const fake = installFakeCli(name, [{ args: ["--version"], stdout: `${name} version 9.9.9` }]);
      cleanups.push(() => fake.restore());
    }
    const dir = tempDir("fd-deps-main-");
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
      // The service manager is the real one's stand-in: no systemctl is asked.
      { serviceInstalled: async () => true, linger: async () => "on" },
    );
    cleanups.push(() => daemon.stop());
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
    const result = (ack?.ok ? ack.data : null) as protocol.DepsResult;
    const by = (id: string) => result.items.find((item) => item.id === id);
    expect(by("claude")).toMatchObject({ state: "ok", version: "9.9.9" });
    expect(by("git")).toMatchObject({ state: "ok" });
    expect(by("gh")).toMatchObject({ state: "ok" });
    // The folder of this test is allowed, and no unit or hook exists in the temporary home.
    expect(by("folders")).toMatchObject({ state: "ok" });
    expect(by("hooks")?.state).not.toBe("ok");
  });

  /** Starts a daemon with this config extra, asks deps.check and returns the answer's rows. */
  async function checkWith(extra: Record<string, unknown>, tag: string) {
    const dir = tempDir(`fd-deps-main-${tag}-`);
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        hostName: "h",
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [dir],
        ...extra,
      }),
    );
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
      { serviceInstalled: async () => true, linger: async () => "on" },
    );
    cleanups.push(() => daemon.stop());
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
    const result = (ack?.ok ? ack.data : null) as protocol.DepsResult;
    return (id: string) => result.items.find((item) => item.id === id);
  }

  test("a claude set up as a service is found at claude.executablePath, not on the PATH (HD-B1)", async () => {
    // The service PATH does not see claude; `flightdeckd setup` writes its path into the config.
    const fake = installFakeCli("claude-svc", [
      { args: ["--version"], stdout: "claude version 7.7.7" },
    ]);
    cleanups.push(() => fake.restore());
    const executablePath = join(
      fake.dir,
      process.platform === "win32" ? "claude-svc.cmd" : "claude-svc",
    );
    const by = await checkWith({ claude: { executablePath } }, "svc");
    expect(by("claude")).toMatchObject({ state: "ok", version: "7.7.7", path: executablePath });
    // The account card is asked because claude is there (the fake daemon answers it).
    expect(by("claudeAuth")?.state).not.toBe("na");
  });

  test("a configured claude path that does not exist is missing, even with a claude on the PATH", async () => {
    const fake = installFakeCli("claude", [
      { args: ["--version"], stdout: "claude version 9.9.9" },
    ]);
    cleanups.push(() => fake.restore());
    const gone = join(tempDir("fd-deps-main-gone-"), "no-such-claude");
    const by = await checkWith({ claude: { executablePath: gone } }, "gone");
    expect(by("claude")).toMatchObject({ state: "missing" });
    expect(by("claudeAuth")).toMatchObject({ state: "na" });
  });
});
