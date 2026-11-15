import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CliDeps, runCli } from "../../src/main.ts";
import { tempDir } from "../support/helpers.ts";

describe("doctor command", () => {
  test("prints each check with its fix and exits 1 when one fails", async () => {
    const out: string[] = [];
    const exits: number[] = [];
    const cliDeps: CliDeps = {
      env: {},
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      exit: (code) => exits.push(code),
      onSignal: () => {},
      exec: async () => ({ code: 1, stdout: "" }),
      serviceContext: (dryRun) => ({
        platform: "linux",
        home: "/h",
        user: "u",
        command: ["/h/flightdeckd"],
        systemRoot: "",
        tempDir: "/tmp",
        dryRun,
        exec: async () => ({ code: 1, stdout: "" }),
        writeFile: () => {},
        removeFile: () => {},
        which: () => null,
      }),
    };
    // A config below a regular file cannot be read or created, on any platform.
    const blocker = join(tempDir("fd-doctor-"), "file");
    writeFileSync(blocker, "x");
    await runCli(["doctor", "--config", join(blocker, "config.json")], cliDeps);
    expect(exits).toEqual([1]);
    expect(out.join("\n")).toMatch(/FAIL\s+config/);
  });

  test("with a readable config it checks the folders, the service, /health, claude, hooks and Tailscale", async () => {
    const daemon = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true }) });
    const dir = tempDir("fd-doctor-");
    const project = join(dir, "project");
    mkdirSync(project);
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        token: "t".repeat(32),
        dataDir: dir,
        port: daemon.port,
        allowedRoots: [project],
      }),
    );
    const out: string[] = [];
    const exits: number[] = [];
    const cliDeps: CliDeps = {
      env: {},
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      exit: (code) => exits.push(code),
      onSignal: () => {},
      exec: async () => ({ code: 0, stdout: "100.64.0.9\n" }),
      serviceContext: (dryRun) => ({
        platform: "linux",
        home: dir,
        user: "u",
        command: ["/h/flightdeckd"],
        systemRoot: "",
        tempDir: "/tmp",
        dryRun,
        exec: async (cmd) => ({
          code: 0,
          stdout: cmd.includes("cat") ? "ExecStart=/h/flightdeckd start\n" : "",
        }),
        writeFile: () => {},
        removeFile: () => {},
        which: () => null,
      }),
    };
    await runCli(["doctor", "--config", file], cliDeps);
    await daemon.stop(true);
    const text = out.join("\n");
    expect(text).toMatch(/OK\s+project folders\s+.*project/);
    expect(text).toMatch(/OK\s+service\s+installed/);
    expect(text).toMatch(/OK\s+daemon\s+answering on 127\.0\.0\.1:/);
    expect(text).toMatch(/WARN\s+hooks/);
    expect(text).toMatch(/WARN\s+tailscale/);
    expect(text).toMatch(/(OK|WARN)\s+claude/);
    // Warnings do not fail the run.
    expect(exits).toEqual([0]);
  });

  test("the claude row shows the claude that flightdeckd setup wrote into the config, as Dependencies does (#1673)", async () => {
    const dir = tempDir("fd-doctor-claude-");
    const configured = join(dir, "bin", "claude-from-setup");
    mkdirSync(join(dir, "bin"));
    writeFileSync(configured, "#!/bin/sh\n");
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        token: "t".repeat(32),
        dataDir: dir,
        port: 1,
        allowedRoots: [dir],
        claude: { executablePath: configured },
      }),
    );
    const out: string[] = [];
    const cliDeps: CliDeps = {
      env: {},
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      exit: () => {},
      onSignal: () => {},
      exec: async () => ({ code: 1, stdout: "" }),
      serviceContext: (dryRun) => ({
        platform: "linux",
        home: dir,
        user: "u",
        command: ["/h/flightdeckd"],
        systemRoot: "",
        tempDir: "/tmp",
        dryRun,
        exec: async () => ({ code: 1, stdout: "" }),
        writeFile: () => {},
        removeFile: () => {},
        which: () => null,
      }),
    };
    await runCli(["doctor", "--config", file], cliDeps);
    expect(out.join("\n")).toContain(`OK   claude           ${configured}`);
  });

  test("OpenCode is looked up in the environment the command was given, like the running daemon's (#1673)", async () => {
    const dir = tempDir("fd-doctor-opencode-");
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "opencode"), "#!/bin/sh\n", { mode: 0o755 });
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({ token: "t".repeat(32), dataDir: dir, port: 1, allowedRoots: [dir] }),
    );
    const out: string[] = [];
    const cliDeps: CliDeps = {
      env: { PATH: join(dir, "bin") },
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      exit: () => {},
      onSignal: () => {},
      exec: async () => ({ code: 1, stdout: "" }),
      serviceContext: (dryRun) => ({
        platform: "linux",
        home: dir,
        user: "u",
        command: ["/h/flightdeckd"],
        systemRoot: "",
        tempDir: "/tmp",
        dryRun,
        exec: async () => ({ code: 1, stdout: "" }),
        writeFile: () => {},
        removeFile: () => {},
        which: () => null,
      }),
    };
    await runCli(["doctor", "--config", file], cliDeps);
    expect(out.join("\n")).toContain(`OpenCode is installed (${join(dir, "bin", "opencode")})`);
  });
});
