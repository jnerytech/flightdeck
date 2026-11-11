import { describe, expect, test } from "bun:test";
import type { GhResult } from "../src/github/gh.ts";
import { GithubService } from "../src/github/service.ts";

/** Issue #954: a test or a stop can wait for the `gh` runs the service started. */
function serviceOver(gh: () => Promise<GhResult | null>) {
  return new GithubService({
    gh,
    roots: [],
    board: {} as never,
    issues: {} as never,
    startSession: async () => ({ sessionId: "s1" }),
  });
}

describe("github-service: waiting for the gh runs it started (#954)", () => {
  test("idle settles only once a run in flight has ended, and at once when none is", async () => {
    let release: (result: GhResult) => void = () => {};
    const service = serviceOver(
      () =>
        new Promise<GhResult | null>((resolve) => {
          release = resolve;
        }),
    );
    await service.idle();
    const status = service.status();
    let idle = false;
    const waiting = service.idle().then(() => {
      idle = true;
    });
    // One turn of the event loop: a run still in flight must not have let idle settle.
    await new Promise((resolve) => setImmediate(resolve));
    const before = idle;
    release({ code: 1, stdout: "", stderr: "not logged in" });
    await status;
    await waiting;
    expect([before, idle]).toEqual([false, true]);
  });
});
