import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { type CliDeps, runCli, startDaemon } from "../src/main.ts";
import type { ServiceContext } from "../src/service.ts";
import { poll, tempDir } from "./helpers.ts";

const TOKEN = "cobertura-0361-token-0123456789";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/** A Linux service manager that says the unit is there and linger is off: nothing real is asked. */
const lingerOff = (dryRun: boolean): ServiceContext => ({
  platform: "linux",
  home: "/h",
  user: "u",
  command: ["/h/flightdeckd"],
  systemRoot: "",
  tempDir: "/tmp",
  dryRun,
  exec: async (cmd) => ({
    code: 0,
    stdout: cmd.includes("loginctl") ? "Linger=no\n" : "ExecStart=/h/flightdeckd start\n",
  }),
  writeFile: () => {},
  removeFile: () => {},
  which: () => null,
});

describe("cobertura-0361: the doctor of a running daemon asks the service manager it is given", () => {
  test("without its own probes, doctor.run reads the unit and linger from the service manager", async () => {
    const dir = tempDir("fd-cob-0361-");
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
      { serviceContext: lingerOff },
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
    ws.send(JSON.stringify({ id: "2", type: "doctor.run", payload: {} }));
    const ack = await poll(() => acks.find((a) => a.id === "2"), 4000);
    ws.close();
    expect(ack?.ok).toBe(true);
    const result = (ack?.ok ? ack.data : null) as protocol.DoctorResult;
    const by = (id: string) => result.checks.find((check) => check.id === id);
    expect(by("service")).toMatchObject({ status: "ok", detail: "installed" });
    expect(by("linger")).toMatchObject({
      status: "fail",
      fix: "run: sudo loginctl enable-linger $USER",
    });
  });
});

/** What the CLI needs to run `doctor` or `setup` on a Linux machine of its own, asking nothing real. */
function cliOn(home: string, lines: string[], extra: Partial<CliDeps> = {}): CliDeps {
  return {
    env: {},
    log: { log: (m) => lines.push(m), error: (m) => lines.push(m) },
    exit: () => {},
    onSignal: () => {},
    exec: async () => ({ code: 1, stdout: "" }),
    serviceContext: (dryRun) => ({
      platform: "linux",
      home,
      user: "u",
      command: [join(home, "flightdeckd")],
      systemRoot: "",
      tempDir: home,
      dryRun,
      exec: async (cmd) => ({
        code: 0,
        stdout: cmd.includes("loginctl") ? "Linger=no\n" : "ExecStart=/h/flightdeckd start\n",
      }),
      writeFile: () => {},
      removeFile: () => {},
      which: () => null,
    }),
    ...extra,
  };
}

describe("cobertura-0361: the CLI's own wiring", () => {
  test("doctor says the program the sessions' MCP server runs is gone when it is not there", async () => {
    const dir = tempDir("fd-cob-0361-doctor-");
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({ token: "t".repeat(32), dataDir: dir, port: 1, allowedRoots: [dir] }),
    );
    const lines: string[] = [];
    await runCli(
      ["doctor", "--config", file],
      cliOn(dir, lines, { selfCommand: [join(dir, "gone", "flightdeckd")] }),
    );
    expect(lines.join("\n")).toMatch(/WARN\s+mcp\s+.*gone/);
  });

  test("setup puts the binary in place, adds it to the PATH through ~/.profile it could not read, and warns about linger", async () => {
    const dir = tempDir("fd-cob-0361-setup-");
    const home = join(dir, "home");
    mkdirSync(home);
    const binary = join(dir, "flightdeckd-copy");
    writeFileSync(binary, "#!/bin/sh\n");
    const alive = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => Response.json({ ok: true }),
    });
    stops.push(async () => void alive.stop(true));
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        hostName: "h",
        bind: "127.0.0.1",
        port: alive.port,
        token: "t".repeat(32),
        dataDir: join(dir, "data"),
        allowedRoots: [],
      }),
    );
    const lines: string[] = [];
    await runCli(
      ["setup", "--yes", "--folders", dir, "--config", file],
      cliOn(home, lines, {
        selfCommand: [binary],
        stdin: new ReadableStream({ start: (c) => c.close() }),
        serviceHealthTimeoutMs: 5000,
      }),
    );
    const text = lines.join("\n");
    expect(text).toContain(".profile");
    expect(text).toContain("WARNING: linger is off");
  });
});
