import { afterEach, expect, test } from "bun:test";
import { type FakeCli, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { killTree as killTreeOfCommand, runCommand } from "../src/board/command.ts";
import { killTree } from "../src/runenv/host.ts";

let fake: FakeCli | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
});

const WINDOWS_ARGS = ["/PID", "4321", "/T", "/F"];

test("on Windows, the command killer runs taskkill from PATH by default and waits for it", async () => {
  fake = installFakeCli("taskkill", [{ args: [], stdout: "" }]);
  await killTreeOfCommand(4321, "win32");
  expect(fake.calls()).toEqual([WINDOWS_ARGS]);
});

test("on Windows, the run host killer waits for its default taskkill and a missing one is no error", async () => {
  // No taskkill exists on this platform: starting it fails, and a tree that cannot be ended by it
  // is not an error for the caller.
  await expect(killTree(4321, { platform: "win32" })).resolves.toBeUndefined();
});

test("a command that ran out of time is still given back when ending its tree fails", async () => {
  const result = await runCommand(["sleep", "5"], process.cwd(), undefined, 50, async (pid) => {
    process.kill(pid, "SIGKILL");
    throw new Error("taskkill is not there");
  });
  expect(result.timedOut).toBe(true);
});
