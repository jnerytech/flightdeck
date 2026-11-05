import { describe, expect, test } from "bun:test";
import { DOCTOR_CHECK_IDS } from "@flightdeck/protocol";
import { type DoctorDeps, opencodeCheck, runDoctor } from "../src/doctor.ts";

const verified = { available: true, path: "/bin/opencode", version: "2.2.5", verified: true };

describe("opencode-doctor", () => {
  test("off: installed says how to turn it on; not installed is fine (it is optional)", () => {
    expect(
      opencodeCheck({ enabled: false, found: "/bin/opencode", info: null, platform: "linux" }),
    ).toEqual({
      id: "opencode",
      name: "opencode",
      status: "warn",
      detail: "OpenCode is installed (/bin/opencode) but turned off on this host",
      fix: 'set "opencode": { "enabled": true } in the host config, then restart the daemon',
    });
    expect(opencodeCheck({ enabled: false, found: null, info: null, platform: "linux" })).toEqual({
      id: "opencode",
      name: "opencode",
      status: "ok",
      detail: "OpenCode is not installed (optional)",
    });
  });

  test("on: the verified version is ok on Linux; elsewhere its config folders are unverified on this OS", () => {
    expect(
      opencodeCheck({ enabled: true, found: "/bin/opencode", info: verified, platform: "linux" }),
    ).toEqual({
      id: "opencode",
      name: "opencode",
      status: "ok",
      detail: "OpenCode 2.2.5 (/bin/opencode)",
    });
    for (const platform of ["win32", "darwin"] as const) {
      const check = opencodeCheck({
        enabled: true,
        found: "/bin/opencode",
        info: verified,
        platform,
      });
      expect([check.status, check.detail]).toEqual([
        "warn",
        "OpenCode 2.2.5 (/bin/opencode); its global and system config folders are unverified on this OS",
      ]);
    }
  });

  test("on: another version is not verified, and a reason it is not available is named with its fix", () => {
    const other = opencodeCheck({
      enabled: true,
      found: "/bin/opencode",
      info: { ...verified, version: "2.3.0", verified: false },
      platform: "linux",
    });
    expect([other.status, other.detail]).toEqual([
      "warn",
      "OpenCode 2.3.0 (/bin/opencode) is not the version Flightdeck verified (2.2.5)",
    ]);
    const unsafe = opencodeCheck({
      enabled: true,
      found: "/bin/opencode",
      info: {
        available: false,
        path: "/bin/opencode",
        version: "2.2.5",
        reason: "opencode_unsafe_global",
      },
      platform: "linux",
    });
    expect(unsafe).toEqual({
      id: "opencode",
      name: "opencode",
      status: "warn",
      detail: "OpenCode is turned on but not available: opencode_unsafe_global",
      fix: "see the OpenCode section of the manual for this reason, then restart the daemon",
    });
  });

  test("the doctor reports the row when the host gives it, and it never fails the report", async () => {
    const deps: DoctorDeps = {
      config: () => ({ bind: "127.0.0.1", port: 7420, allowedRoots: ["/w"] }),
      isDirectory: () => true,
      serviceInstalled: async () => true,
      healthy: async () => true,
      tailscaleIp: async () => null,
      hooks: () => "installed",
      claudePath: () => "/usr/bin/claude",
      opencode: async () => ({
        enabled: true,
        found: null,
        info: { available: false, reason: "opencode_missing" },
        platform: "linux",
      }),
    };
    const report = await runDoctor(deps);
    expect(report.checks.find((c) => c.id === "opencode")?.status).toBe("warn");
    expect(report.ok).toBe(true);
    expect(DOCTOR_CHECK_IDS as readonly string[]).toContain("opencode");
  });
});
