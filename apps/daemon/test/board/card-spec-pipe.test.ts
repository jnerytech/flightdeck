import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readSpec } from "../../src/board/spec.ts";
import { tempDir } from "../support/helpers.ts";

describe("card-spec: an odd file is not a spec", () => {
  // platform: mkfifo does not exist on Windows.
  test.skipIf(process.platform === "win32")(
    "a named pipe is never opened: it would block the daemon waiting for a writer",
    async () => {
      const root = tempDir("fd-spec-pipe-");
      const made = Bun.spawnSync(["mkfifo", join(root, "pipe.md")]);
      expect(made.exitCode).toBe(0);
      expect(await readSpec(root, "pipe.md")).toEqual({ found: false, heading: null });
    },
  );
});
