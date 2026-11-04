import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DepResult } from "@flightdeck/protocol";
import type { DepsEnv } from "../src/deps/deps.ts";
import { formatDeps } from "../src/deps/format.ts";
import { type CliDeps, runCli } from "../src/main.ts";
import { tempDir } from "./helpers.ts";

const dep = (
  id: DepResult["id"],
  group: DepResult["group"],
  state: DepResult["state"],
  extra: Partial<DepResult> = {},
): DepResult => ({
  id,
  group,
  state,
  breaks: [],
  fix: [{ os: "linux", command: `sudo apt install ${id}` }],
  ...extra,
});

describe("deps-doctor: the terminal prints the same grouping as the app", () => {
  test("a headline, Required then Optional, each with its state, and for what is wrong what breaks and the fix", () => {
    const lines = formatDeps(
      {
        items: [
          dep("claude", "required", "ok", { version: "2.1.0", path: "/usr/bin/claude" }),
          dep("git", "required", "missing", { breaks: ["projects", "worktrees"] }),
          dep("gh", "optional", "outdated", { breaks: ["github"], version: "2.1.0" }),
          dep("pwsh", "optional", "na"),
        ],
      },
      "linux",
    );
    expect(lines[0]).toBe("Dependencies: 1 required missing");
    const text = lines.join("\n");
    expect(text.indexOf("Required")).toBeLessThan(text.indexOf("Optional"));
    expect(text).toMatch(/OK\s+claude\s+2\.1\.0\s+\/usr\/bin\/claude/);
    expect(text).toMatch(/MISSING\s+git/);
    expect(text).toContain("without it: projects, card worktrees and branches");
    expect(text).toContain("-> sudo apt install git");
    expect(text).toMatch(/OUTDATED\s+gh/);
    expect(text).toMatch(/N\/A\s+pwsh/);
    // What is fine needs no fix line.
    expect(text).not.toContain("sudo apt install claude");
  });

  test("a missing program shows its install page, with the package-manager line when there is one", () => {
    const lines = formatDeps(
      {
        items: [
          dep("az", "optional", "missing", {
            fix: [
              { os: "linux", url: "https://learn.microsoft.com/cli/azure/install-azure-cli-linux" },
            ],
          }),
          dep("gh", "optional", "missing", {
            fix: [{ os: "linux", command: "sudo apt install gh", url: "https://cli.github.com" }],
          }),
        ],
      },
      "linux",
    ).join("\n");
    expect(lines).toContain("page: https://learn.microsoft.com/cli/azure/install-azure-cli-linux");
    expect(lines).not.toContain("-> undefined");
    expect(lines).toContain("-> sudo apt install gh");
    expect(lines).toContain("page: https://cli.github.com");
  });

  test("everything in place says so in the headline", () => {
    expect(formatDeps({ items: [dep("claude", "required", "ok")] }, "linux")[0]).toBe(
      "Dependencies: all set",
    );
    expect(
      formatDeps(
        { items: [dep("claude", "required", "ok"), dep("gh", "optional", "missing")] },
        "linux",
      )[0],
    ).toBe("Dependencies: 1 optional missing");
  });

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
});
