import { describe, expect, spyOn, test } from "bun:test";
import { git, hooksOff, must, SAFE } from "../src/teleport/git.ts";
import { tempDir } from "./helpers.ts";

/**
 * Issue #100 (#715): the git calls of a teleport run no hook of the repository. `/dev/null` is a
 * path on Linux and macOS; on Windows it would be `C:\\dev\\null`, a folder anyone can fill, so
 * there the hooks path is the device name `NUL`, which no folder can be.
 */
describe("teleport-git: where the hooks point (#715)", () => {
  test("a device on every platform; never a folder a repository could hold hooks in", () => {
    expect([hooksOff("linux"), hooksOff("darwin"), hooksOff("win32")]).toEqual([
      "/dev/null",
      "/dev/null",
      "NUL",
    ]);
  });

  test("the safe config carries this platform's hooks path, fsmonitor off and no signature check", () => {
    expect(SAFE).toEqual([
      "-c",
      `core.hooksPath=${hooksOff()}`,
      "-c",
      "core.fsmonitor=false",
      "-c",
      "log.showSignature=false",
    ]);
  });
});

describe("teleport-git: a daemon that has stopped starts no git (#715, #1110)", () => {
  test("a signal that has already fired spawns nothing: the call answers as a failed one", async () => {
    const spawned = spyOn(Bun, "spawn");
    try {
      const out = await git(tempDir(), ["status"], {}, AbortSignal.abort());
      const refused = await must(tempDir(), ["status"], {}, AbortSignal.abort()).then(
        () => "ran",
        (error: { reason?: string }) => error.reason ?? "refused",
      );
      expect([out, refused, spawned.mock.calls.length]).toEqual([null, "teleport_git", 0]);
    } finally {
      spawned.mockRestore();
    }
  });
});
