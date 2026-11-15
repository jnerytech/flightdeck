import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import type { DepsEnv } from "../../src/deps/domain/deps.ts";
import { type CliDeps, runCli } from "../../src/main.ts";
import { tempDir } from "../support/helpers.ts";

describe("deps-doctor: the terminal prints the same grouping as the app", () => {
  test("flightdeckd doctor prints them after its own checks", async () => {
    const out: string[] = [];
    const dir = tempDir("fd-doctor-deps-");
    const project = join(dir, "project");
    mkdirSync(project);
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({ token: "t".repeat(32), dataDir: dir, port: 1, allowedRoots: [project] }),
    );
    const machine: DepsEnv = {
      platform: "linux",
      which: (name) => (name === "git" ? null : `/usr/bin/${name}`),
      version: async () => "1.0.0",
      allowedRoots: [project],
      serviceInstalled: async () => true,
      linger: async () => "on",
      hooks: async () => "installed",
      account: async () => "signed_in",
    };
    const cliDeps: CliDeps = {
      env: {},
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      exit: () => {},
      onSignal: () => {},
      exec: async () => ({ code: 1, stdout: "" }),
      depsEnv: machine,
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
    await runCli(["doctor", "--config", file], cliDeps);
    const text = out.join("\n");
    expect(text).toContain("Dependencies: 1 required missing");
    expect(text).toMatch(/MISSING\s+git/);
    expect(text.indexOf("project folders")).toBeLessThan(text.indexOf("Dependencies:"));
  });

  test("flightdeckd doctor exits 1 when a required dependency is missing, whatever its own checks say (HD-m5)", async () => {
    const dir = tempDir("fd-doctor-exit-");
    const project = join(dir, "project");
    mkdirSync(project);
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({ token: "t".repeat(32), dataDir: dir, port: 1, allowedRoots: [project] }),
    );
    const codes: number[] = [];
    const run = async (missing: string | null) => {
      await runCli(["doctor", "--config", file], {
        env: {},
        log: { log: () => {}, error: () => {} },
        exit: (code) => void codes.push(code),
        onSignal: () => {},
        exec: async () => ({ code: 1, stdout: "" }),
        depsEnv: {
          platform: "linux",
          which: (name) => (name === missing ? null : `/usr/bin/${name}`),
          version: async () => "9.9.9",
          allowedRoots: [project],
          serviceInstalled: async () => true,
          linger: async () => "on",
          hooks: async () => "installed",
          account: async () => "signed_in",
        },
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
      } as CliDeps);
      return codes.at(-1);
    };
    expect(await run("git")).toBe(1);
  });

  test("the terminal looks for claude at claude.executablePath like the daemon does, and a configured path that is gone is missing (HD-B1)", async () => {
    const fake = installFakeCli("claude-doc", [
      { args: ["--version"], stdout: "claude version 6.6.6" },
    ]);
    try {
      const there = join(fake.dir, process.platform === "win32" ? "claude-doc.cmd" : "claude-doc");
      const lines = async (executablePath: string) => {
        const out: string[] = [];
        const dir = tempDir("fd-doctor-claude-");
        const file = join(dir, "config.json");
        writeFileSync(
          file,
          JSON.stringify({
            token: "t".repeat(32),
            dataDir: dir,
            port: 1,
            allowedRoots: [dir],
            claude: { executablePath },
          }),
        );
        await runCli(["doctor", "--config", file], {
          env: {},
          log: { log: (m) => out.push(m), error: (m) => out.push(m) },
          exit: () => {},
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
        } as CliDeps);
        return out.join("\n");
      };
      expect(await lines(there)).toMatch(/OK\s+claude\s+6\.6\.6/);
      expect(await lines(join(fake.dir, "gone"))).toMatch(/MISSING\s+claude\s/);
    } finally {
      fake.restore();
    }
  });
});
