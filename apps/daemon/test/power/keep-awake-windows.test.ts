import { describe, expect, test } from "bun:test";
import { spawnHolder } from "../../src/power/adapters/holder.ts";
import { holderCommand } from "../../src/power/domain/keep-awake.ts";
import { poll } from "../support/helpers.ts";

describe("keep-awake: the real Windows script holds while the daemon lives", () => {
  test.skipIf(process.platform !== "win32")(
    "on Windows the real script holds: it stays alive while the daemon's pid lives, and leaves after it",
    async () => {
      const helper = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 4000)"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      const found = holderCommand({
        platform: "win32",
        pid: helper.pid,
        which: (name) => Bun.which(name),
      });
      expect("cmd" in found).toBe(true);
      const holder = spawnHolder("cmd" in found ? found.cmd : []);
      expect(holder).not.toBeNull();
      let ended = false;
      void holder?.exited.then(() => {
        ended = true;
      });
      // Add-Type takes a moment; if SetThreadExecutionState failed, the script would have exited by now.
      expect(await poll(() => ended, 2500)).toBeNull();
      await helper.exited;
      expect(await poll(() => ended, 15_000)).toBe(true);
    },
  );
});
