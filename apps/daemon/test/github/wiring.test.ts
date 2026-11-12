import { describe, expect, test } from "bun:test";
import { githubOptions } from "../../src/github/wiring.ts";

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
});
