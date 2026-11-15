import { describe, expect, test } from "bun:test";
import { type DoctorDeps, runDoctor } from "../../src/deps/domain/doctor.ts";

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

  test("linger off is a failure with the command that fixes it; on or not applicable adds no failure", async () => {
    const off = await runDoctor(deps({ linger: async () => "off" }));
    expect(off.ok).toBe(false);
    expect(off.checks.find((c) => c.id === "linger")).toMatchObject({
      status: "fail",
      fix: "run: sudo loginctl enable-linger $USER",
    });
    expect(off.checks.find((c) => c.id === "linger")?.detail).toContain("after a reboot");
    const on = await runDoctor(deps({ linger: async () => "on" }));
    expect(on.checks.find((c) => c.id === "linger")).toMatchObject({ status: "ok" });
    expect(on.ok).toBe(true);
    const none = await runDoctor(deps({ linger: async () => null }));
    expect(none.checks.find((c) => c.id === "linger")).toBeUndefined();
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

describe("doctor for the app", () => {
  test("every check carries a stable id the app names and fixes in its own language", async () => {
    const report = await runDoctor(deps());
    expect(report.checks.map((c) => c.id)).toEqual([
      "config",
      "folders",
      "service",
      "daemon",
      "claude",
      "hooks",
      "tailscale",
    ]);
  });

  test("a folder check may be async, so the running daemon never blocks on the disk", async () => {
    const report = await runDoctor(deps({ isDirectory: async () => false }));
    expect(find(report.checks, "project folders")).toMatchObject({ status: "fail" });
    const fine = await runDoctor(deps({ isDirectory: async () => true }));
    expect(find(fine.checks, "project folders")).toMatchObject({ status: "ok" });
  });

  test("the daemon version is reported, and an app of another minor gets a warning with the fix", async () => {
    const same = await runDoctor(deps({ version: { daemon: "0.32.0", app: "0.32.4" } }));
    expect(same.checks.at(-1)).toMatchObject({ id: "version", status: "ok", detail: "0.32.0" });
    const alone = await runDoctor(deps({ version: { daemon: "0.32.0" } }));
    expect(alone.checks.at(-1)).toMatchObject({ id: "version", status: "ok" });
    const older = await runDoctor(deps({ version: { daemon: "0.30.1", app: "0.32.0" } }));
    const version = older.checks.at(-1);
    expect(version).toMatchObject({ id: "version", status: "warn" });
    expect(version?.detail).toContain("0.30.1");
    expect(version?.detail).toContain("0.32.0");
    expect(version?.fix).toContain("flightdeckd update");
    expect(older.ok).toBe(true);
  });
});
