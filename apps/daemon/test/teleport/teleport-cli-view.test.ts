import { describe, expect, test } from "bun:test";
import type { TeleportManifest } from "@flightdeck/protocol";
import {
  importUnsure,
  movedLine,
  packageRefusal,
  prepareRefusal,
  progressLine,
  summaryJson,
  summaryLines,
} from "../../src/teleport/domain/teleport-cli-view.ts";

const manifest = (over: Partial<TeleportManifest> = {}): TeleportManifest =>
  ({
    id: "pkg-1",
    sessionId: "s1",
    claudeSessionId: "claude-1",
    cwd: "/work/api",
    model: null,
    permissionMode: "default",
    persona: null,
    expiresAt: "2026-11-21T12:00:00.000Z",
    parts: [
      { name: "transcript", size: 512, sha256: "a".repeat(64) },
      { name: "code", size: 3 * 1024 * 1024, sha256: "b".repeat(64) },
      { name: "extra", size: 2048, sha256: "c".repeat(64) },
    ],
    secrets: { lines: 0, labels: [] },
    git: null,
    ...over,
  }) as TeleportManifest;

describe("teleport CLI words (issue #3704)", () => {
  test("the summary gives sizes in the unit that reads best, a default model and no persona", () => {
    const lines = summaryLines("api", "server", manifest());
    expect(lines[1]).toBe("model default, permission mode default, persona none");
    expect(lines[2]).toBe("parts: transcript 512 B, code 3.0 MB, extra 2.0 KB");
  });

  test("with no code and no secret line it says so", () => {
    const lines = summaryLines("api", "server", manifest());
    expect(lines[3]).toBe("code: none");
    expect(lines[4]).toBe("secrets: no line looks like one");
  });

  test("a detached head and one commit, one file and a secret with no label read right", () => {
    const git = {
      branch: null,
      head: "c".repeat(40),
      base: "origin/main",
      baseSha: "d".repeat(40),
      ref: "refs/teleport/pkg-1",
      ahead: 1,
      changed: 1,
    };
    const lines = summaryLines(
      "api",
      "server",
      manifest({ git, secrets: { lines: 1, labels: [] } } as Partial<TeleportManifest>),
    );
    expect(lines[3]).toBe("code: branch (detached), 1 commit ahead of origin/main, 1 file changed");
    expect(lines[4]).toBe("secrets: 1 line looks like one: they move with the session");
  });

  test("the JSON summary holds counts, sizes and kinds, and no git when there is no code", () => {
    expect(summaryJson(manifest())).toEqual({
      model: null,
      permissionMode: "default",
      persona: null,
      parts: [
        { name: "transcript", size: 512 },
        { name: "code", size: 3 * 1024 * 1024 },
        { name: "extra", size: 2048 },
      ],
      git: null,
      secrets: { lines: 0, labels: [] },
    });
  });

  test("a progress line and the moved line name what moved and where", () => {
    expect(progressLine(5, 14)).toBe("sent 5 of 14 bytes");
    expect(movedLine("api", "server", { sessionId: "t1", worktree: "/wt", branch: "tp/x" })).toBe(
      "moved api to server as session t1 (branch tp/x, /wt)",
    );
  });

  test("every refusal of the source's prepare says what to do, and an unknown one keeps the daemon's text", () => {
    expect(prepareRefusal("api", "teleport_busy", "d")).toBe(
      "api is not idle: let it finish its turn, then move it",
    );
    expect(prepareRefusal("api", "teleport_team", "d")).toContain("belongs to a team");
    expect(prepareRefusal("api", "teleport_runtime", "d")).toContain("only a Claude session");
    expect(prepareRefusal("api", "teleport_no_transcript", "d")).toContain("no transcript");
    expect(prepareRefusal("api", "teleport_too_many", "d")).toContain("try again");
    expect(prepareRefusal("api", "teleport_stopped", "d")).toContain("is stopping");
    expect(prepareRefusal("api", "other", "the daemon's text")).toBe("the daemon's text");
    expect(prepareRefusal("api", undefined, "no reason")).toBe("no reason");
  });

  test("the two package refusals and the silent import are worded apart", () => {
    expect(packageRefusal("teleport_corrupt")).toContain("does not hold together");
    expect(packageRefusal("teleport_incomplete")).toContain("stopped before the end");
    expect(importUnsure("server")).toContain("server did not answer the import");
    expect(importUnsure("server")).toContain("was not archived");
  });
});
