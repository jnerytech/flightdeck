import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { createGithub, githubOptions } from "../../src/github/wiring.ts";
import { tempDir } from "../support/helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * The `github.*` commands as main.ts builds them (issue #1593): the allowed roots are the
 * config's own array, and a session started from an issue reaches the session manager with its folder,
 * prompt and name only.
 */

function built() {
  const created: unknown[] = [];
  const board = {} as never;
  const issues = {} as never;
  const config = { allowedRoots: ["/w"] };
  const options = githubOptions({
    config,
    board,
    issues,
    manager: {
      create: async (opts) => {
        created.push(opts);
        return { sessionId: "s1" } as never;
      },
    },
  });
  return { options, created, board, issues, config };
}

describe("github-wiring: the github commands the daemon builds (#1593)", () => {
  test("a session started from an issue gets its folder, prompt and name, nothing more", async () => {
    const { options, created } = built();
    const extra = { cwd: "/w/p", prompt: "Fix #7", name: "Issue 7", model: "x" };
    const started = await options.startSession(extra);
    expect([started, created]).toEqual([
      { sessionId: "s1" },
      [{ cwd: "/w/p", prompt: "Fix #7", name: "Issue 7" }],
    ]);
  });

  test("the allowed roots are the config's own array, so a root added later reaches the service", () => {
    const { options, board, issues, config } = built();
    expect([
      options.roots === config.allowedRoots,
      options.board === board,
      options.issues === issues,
    ]).toEqual([true, true, true]);
  });

  test("the module hands the server the github commands and the alerts of a folder, read with gh", async () => {
    const before = process.env.PATH;
    process.env.PATH = realpathSync.native(tempDir("fd-no-gh-"));
    cleanups.push(() => {
      process.env.PATH = before;
    });
    const { modules } = createGithub({
      config: { allowedRoots: ["/w"] },
      board: {} as never,
      issues: {} as never,
      manager: { create: async () => ({ sessionId: "s1" }) as never },
    });
    const server = modules[0].server;
    expect([typeof server?.github, await server?.alerts?.(process.cwd())]).toEqual([
      "object",
      {
        alerts: [],
        unavailable: [
          { kind: "code-scanning", reason: "gh_missing" },
          { kind: "dependabot", reason: "gh_missing" },
        ],
      },
    ]);
  });
});
