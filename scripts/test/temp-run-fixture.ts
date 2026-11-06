// Run by temp-run.test.ts as `bun test` under the real preload (the name keeps it out of the suite):
// it leaves in the temp folder what tests leave, a folder of its own and one of a child process,
// and fails when FD_TEMP_RUN_FAIL is set.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("leaves folders in the temp folder, its own and a child's", () => {
  const own = mkdtempSync(join(tmpdir(), "fd-test-"));
  writeFileSync(join(own, "file.txt"), "x");
  const child = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      "require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fd-child-'))",
    ],
    { env: process.env },
  );
  console.log(`temp-run-fixture tmpdir=${tmpdir()}`);
  expect(child.exitCode).toBe(0);
  expect(process.env.FD_TEMP_RUN_FAIL ?? "").toBe("");
});
