import { describe, expect, test } from "bun:test";
import { hooksOff, SAFE } from "../src/teleport/git.ts";

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
