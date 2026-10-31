import { describe, expect, test } from "bun:test";
import { type DoctorDeps, runDoctor } from "../src/doctor.ts";
import { type CliDeps, runCli } from "../src/main.ts";

const config = { bind: "127.0.0.1", port: 7777, allowedRoots: ["/code"] };

function deps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    config: () => config,
    isDirectory: () => true,
    serviceInstalled: async () => true,
    healthy: async () => true,
    tailscaleIp: async () => null,
    hooks: () => "installed",
    claudePath: () => "/usr/bin/claude",
    ...overrides,
  };
}

const find = (checks: Awaited<ReturnType<typeof runDoctor>>["checks"], name: string) =>
  checks.find((check) => check.name === name);

describe("doctor", () => {
  test("everything in place: every check passes and the report is ok", async () => {
    const report = await runDoctor(deps());
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => [c.name, c.status])).toEqual([
      ["config", "ok"],
      ["project folders", "ok"],
      ["service", "ok"],
      ["daemon", "ok"],
      ["claude", "ok"],
      ["hooks", "ok"],
      ["tailscale", "ok"],
    ]);
  });

  test("an unreadable config says the cause and stops: nothing else can be checked", async () => {
    const report = await runDoctor(
      deps({
        config: () => {
          throw new Error("invalid JSON at line 3");
        },
      }),
    );
    expect(report.ok).toBe(false);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({ name: "config", status: "fail" });
    expect(report.checks[0]?.detail).toContain("invalid JSON at line 3");
    expect(report.checks[0]?.fix).toContain("flightdeckd setup");
  });

  test("no project folder, or one that is gone, fails with the fix", async () => {
    const none = await runDoctor(deps({ config: () => ({ ...config, allowedRoots: [] }) }));
    expect(find(none.checks, "project folders")).toMatchObject({ status: "fail" });
    expect(find(none.checks, "project folders")?.fix).toContain("flightdeckd setup");
    const gone = await runDoctor(deps({ isDirectory: () => false }));
    expect(find(gone.checks, "project folders")?.detail).toContain("/code");
    expect(gone.ok).toBe(false);
  });

  test("no service installed: the fix is setup", async () => {
    const report = await runDoctor(deps({ serviceInstalled: async () => false }));
    expect(find(report.checks, "service")).toMatchObject({ status: "fail" });
    expect(find(report.checks, "service")?.fix).toContain("flightdeckd setup");
  });

  test("daemon not answering: the fix is service start, naming the address", async () => {
    const report = await runDoctor(deps({ healthy: async () => false }));
    const daemon = find(report.checks, "daemon");
    expect(daemon?.status).toBe("fail");
    expect(daemon?.detail).toContain("127.0.0.1:7777");
    expect(daemon?.fix).toContain("flightdeckd service start");
  });

  test("claude missing, and hooks absent or outdated, are warnings that do not fail the report", async () => {
    const report = await runDoctor(deps({ claudePath: () => null, hooks: () => "absent" }));
    expect(report.ok).toBe(true);
    expect(find(report.checks, "claude")).toMatchObject({ status: "warn" });
    expect(find(report.checks, "hooks")?.fix).toContain("flightdeckd hooks install");
    const outdated = await runDoctor(deps({ hooks: () => "outdated" }));
    expect(find(outdated.checks, "hooks")?.fix).toContain("flightdeckd hooks install");
  });

  test("Tailscale up but the daemon on the loopback: a warning that says how to open it", async () => {
    const report = await runDoctor(deps({ tailscaleIp: async () => "100.64.0.9" }));
    expect(report.ok).toBe(true);
    const tailscale = find(report.checks, "tailscale");
    expect(tailscale?.status).toBe("warn");
    expect(tailscale?.fix).toContain("flightdeckd setup");
    const open = await runDoctor(
      deps({
        tailscaleIp: async () => "100.64.0.9",
        config: () => ({ ...config, bind: "0.0.0.0" }),
      }),
    );
    expect(find(open.checks, "tailscale")?.status).toBe("ok");
  });
});

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
    await runCli(["doctor", "--config", "/nonexistent-dir/none.json"], cliDeps);
    expect(exits).toEqual([1]);
    expect(out.join("\n")).toMatch(/FAIL\s+config/);
  });
});
