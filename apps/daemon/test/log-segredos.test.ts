import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as protocol from "@flightdeck/protocol";
import { FileLog } from "../src/logs/file-log.ts";
import { createLogScanner } from "../src/logs/scanner.ts";
import { startDaemon } from "../src/main.ts";
import { Vault } from "../src/vault/vault.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(20_000);
// Bare, prefix-less values, as the real tokens are: no pattern knows their shape.
const TOKEN = "Zk3fakeprotocoltoken0123456789abcdefghijklmnop";
const HOOKS = "Qw8fakehookstoken0123456789abcdefghijklmnop";
const ROTATED = "Lm5fakerotatedtoken0123456789abcdefghijklmnop";
const VAULT_VALUE = "Vx9fakevaultvalue0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("log-segredos: the scanner of the daemon's log knows the daemon's own secrets (issue #255)", () => {
  test("the tokens and the vault's held values are removed, read at each line", () => {
    let tokens = [TOKEN];
    let held: string[] = [];
    const scanner = createLogScanner({ tokens: () => tokens, vaultValues: () => held });
    expect(scanner.redact(`rejected ${TOKEN} twice ${TOKEN}`)).toBe(
      "rejected [redacted] twice [redacted]",
    );
    expect(scanner.redact(`vault ${VAULT_VALUE}`)).toContain(VAULT_VALUE);
    held = [VAULT_VALUE];
    expect(scanner.redact(`vault ${VAULT_VALUE}`)).toBe("vault [redacted]");
    tokens = [TOKEN, ROTATED];
    expect(scanner.redact(`new ${ROTATED}`)).toBe("new [redacted]");
  });

  test("the vault reports what it holds, and what it dropped is no longer reported", () => {
    const vault = new Vault();
    expect(vault.heldValues()).toEqual([]);
    vault.deliver(
      {
        secretId: "s1",
        value: VAULT_VALUE,
        purpose: "p",
        expiresAt: Date.now() + 30_000,
        requester: "claude",
      },
      "127.0.0.1",
    );
    expect(vault.heldValues()).toEqual([VAULT_VALUE]);
    vault.stop();
    expect(vault.heldValues()).toEqual([]);
  });

  test("a real value of the fake vault never reaches the file, even typed into a log line", () => {
    const vault = new Vault();
    vault.deliver(
      {
        secretId: "s1",
        value: VAULT_VALUE,
        purpose: "p",
        expiresAt: Date.now() + 30_000,
        requester: "claude",
      },
      "127.0.0.1",
    );
    const dir = tempDir("fd-logsec-");
    const log = new FileLog({
      dir,
      scanner: createLogScanner({ tokens: () => [], vaultValues: () => vault.heldValues() }),
    });
    log.write("error", `ssh failed with ${VAULT_VALUE}`);
    return log.flush().then(() => {
      expect(readFileSync(log.path(), "utf8")).not.toContain(VAULT_VALUE);
      vault.stop();
    });
  });
});

describe("log-segredos: a booted daemon never writes its own tokens (issue #255)", () => {
  async function boot() {
    const dir = tempDir("fd-logboot-");
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        hostName: "h",
        port: 0,
        token: TOKEN,
        hooks: { token: HOOKS, port: 0 },
        dataDir: join(dir, "data"),
        allowedRoots: [dir],
      }),
    );
    const logDir = join(dir, "logs");
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
      { logDir, configWatchMs: 20 },
    );
    cleanups.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return { dir, file, logDir, daemon, client };
  }

  test("the protocol token and the hooks token are redacted in the file and in logs.tail", async () => {
    const { logDir, daemon, client } = await boot();
    daemon.logger.error(`hello rejected: ${TOKEN}`);
    daemon.logger.log(`hook said ${HOOKS}`);
    const tail = await client.data<protocol.LogTail>("logs.tail", { lines: 100 });
    const all = `${tail?.lines.join("\n")}\n${readFileSync(join(logDir, "flightdeckd.log"), "utf8")}`;
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(HOOKS);
    expect(all).toContain("hello rejected: [redacted]");
  });

  test("a token rotated in the config file is redacted from then on", async () => {
    const { file, logDir, daemon } = await boot();
    const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...config, token: ROTATED }));
    const deadline = Date.now() + 5_000;
    let hidden = false;
    while (!hidden && Date.now() < deadline) {
      await Bun.sleep(60);
      daemon.logger.log(`probe ${ROTATED}`);
      await Bun.sleep(60);
      hidden = !readFileSync(join(logDir, "flightdeckd.log"), "utf8")
        .split("\n")
        .filter((line) => line.includes("probe"))
        .at(-1)
        ?.includes(ROTATED);
    }
    expect(hidden).toBe(true);
  });

  test("the read side redacts too: a secret planted in the file is not handed out by logs.tail", async () => {
    const { logDir, client } = await boot();
    appendFileSync(
      join(logDir, "flightdeckd.log"),
      "2026-11-05T12:00:00.000Z INFO leaked ghp_abcdefghijklmnopqrstuvwxyz0123456789\n",
    );
    const tail = await client.data<protocol.LogTail>("logs.tail", { lines: 100 });
    expect(tail?.lines.join("\n")).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(tail?.lines.join("\n")).toContain("leaked [redacted]");
  });
});
