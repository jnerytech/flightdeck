import { describe, expect, test } from "bun:test";
import { checkDeps, type DepsEnv } from "../src/deps/deps.ts";

/** A machine with nothing installed: every program is missing, so every fix is on offer. */
const bare = (platform: DepsEnv["platform"]): DepsEnv => ({
  platform,
  which: () => null,
  version: async () => null,
  allowedRoots: [],
  serviceInstalled: async () => false,
  linger: async () => "off",
  hooks: async () => "absent",
  account: async () => "signed_out",
});

const PIPED = /\|\s*(sudo|bash|sh|zsh)\b/;

describe("deps-fix-links: what a missing program offers to copy", () => {
  test("no fix pipes a download into a shell, on any system", async () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      const { items } = await checkDeps(bare(platform));
      for (const item of items) {
        for (const fix of item.fix) {
          expect([item.id, fix.os, PIPED.test(fix.command ?? "")]).toEqual([
            item.id,
            fix.os,
            false,
          ]);
        }
      }
    }
  });

  test("every installer row has its official install page, and a command only where a package manager has one", async () => {
    const { items } = await checkDeps(bare("linux"));
    const installers = ["claude", "git", "gh", "az", "ssh", "tailscale"];
    for (const id of installers) {
      const item = items.find((i) => i.id === id);
      for (const fix of item?.fix ?? []) {
        expect([id, fix.os, fix.url?.startsWith("https://")]).toEqual([id, fix.os, true]);
      }
    }
    const az = items.find((i) => i.id === "az");
    expect(az?.fix.find((f) => f.os === "linux")?.command).toBeUndefined();
    expect(az?.fix.find((f) => f.os === "linux")?.url).toContain("learn.microsoft.com");
    expect(az?.fix.find((f) => f.os === "darwin")?.command).toBe("brew install azure-cli");
    const tailscale = items.find((i) => i.id === "tailscale");
    expect(tailscale?.fix.find((f) => f.os === "linux")?.command).toBeUndefined();
    expect(tailscale?.fix.find((f) => f.os === "win32")?.command).toContain("winget");
  });
});
