import { describe, expect, test } from "bun:test";
import type { DepResult } from "@flightdeck/protocol";
import { checkDeps, type DepsEnv } from "../src/deps/deps.ts";

/** A machine where `present` programs exist at the versions given, and nothing else. */
function machine(
  platform: DepsEnv["platform"],
  present: Record<string, string> = {},
  over: Partial<DepsEnv> = {},
): DepsEnv {
  return {
    platform,
    which: (name) => (name in present ? `/usr/bin/${name}` : null),
    version: async (path) => present[path.split("/").pop() ?? ""] ?? null,
    allowedRoots: [],
    serviceInstalled: async () => false,
    linger: async () => "on",
    hooks: async () => "installed",
    account: async () => "signed_in",
    ...over,
  };
}

const item = (items: DepResult[], id: string) => items.find((i) => i.id === id) as DepResult;
const fixOf = (result: DepResult, os: string) => result.fix.find((f) => f.os === os);

describe("deps-advice: install advice that is true on the system it is shown for (#214)", () => {
  test("a gh older than the one that has `gh project` is outdated, and Linux is sent to the install page, not to apt", async () => {
    const { items } = await checkDeps(machine("linux", { gh: "2.30.1" }));
    expect(item(items, "gh")).toMatchObject({ state: "outdated", minVersion: "2.31.0" });
    const { items: newer } = await checkDeps(machine("linux", { gh: "2.31.0" }));
    expect(item(newer, "gh").state).toBe("ok");
    const linux = fixOf(item(items, "gh"), "linux");
    expect(linux?.command).toBeUndefined();
    expect(linux?.url).toBe("https://cli.github.com");
    // The other systems keep their package manager.
    expect(fixOf(item(items, "gh"), "darwin")?.command).toBe("brew install gh");
  });

  test("OpenSSH on Windows comes with the note that it needs an elevated PowerShell", async () => {
    const { items } = await checkDeps(machine("win32"));
    expect(fixOf(item(items, "ssh"), "win32")).toMatchObject({
      command: "Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0",
      note: "elevated",
    });
    expect(fixOf(item(items, "ssh"), "linux")?.note).toBeUndefined();
  });

  test("Linux without systemd has no `service install` to offer, and says so", async () => {
    const { items } = await checkDeps(machine("linux", { git: "2.43.0" }));
    const service = item(items, "service");
    expect(service.state).toBe("missing");
    expect(fixOf(service, "linux")).toEqual({ os: "linux", note: "noSystemd" });
  });

  test("with systemd the service advice is unchanged: install the service, or enable linger", async () => {
    const withSystemd = { systemctl: "255" };
    const { items } = await checkDeps(machine("linux", withSystemd));
    expect(fixOf(item(items, "service"), "linux")).toEqual({
      os: "linux",
      command: "flightdeckd service install",
    });
    const { items: lingerOff } = await checkDeps(
      machine("linux", withSystemd, {
        serviceInstalled: async () => true,
        linger: async () => "off",
      }),
    );
    expect(fixOf(item(lingerOff, "service"), "linux")?.command).toBe(
      "sudo loginctl enable-linger $USER",
    );
  });
});
