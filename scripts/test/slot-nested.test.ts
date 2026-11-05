import { expect, test } from "bun:test";
import {} from "node:fs";
import { join } from "node:path";
import { realTempDir } from "./temp-dir.ts";

const SLOT = join(import.meta.dir, "../slot.ts");

test("slot-reentrant: a slot call made under the slot runs and finishes, with the real script and its own lock", async () => {
  const lock = join(realTempDir("fd-slot-nested-"), "slot.lock");
  // Without the rule the inner call waits for the lock the outer one holds: the test would hang.
  const say = ["-e", "console.log('nested ok')"];
  const proc = Bun.spawn(
    [process.execPath, SLOT, process.execPath, SLOT, process.execPath, ...say],
    {
      env: { ...process.env, FLIGHTDECK_SLOT_LOCK: lock, FLIGHTDECK_SLOT_HOLDER: "" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const timer = setTimeout(() => proc.kill(), 15_000);
  const code = await proc.exited;
  clearTimeout(timer);
  expect(await new Response(proc.stdout).text()).toContain("nested ok");
  expect(code).toBe(0);
});

test("slot-reentrant: what runs under the slot is told which lock is the slot's, whatever its own temp folder", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "fd-slot-lock-"));
  const env: Record<string, string | undefined> = { ...process.env, FLIGHTDECK_SLOT_HOLDER: "" };
  // No lock path given: the slot derives it from the temp folder, and says so to its child.
  env.FLIGHTDECK_SLOT_LOCK = undefined;
  env.TMPDIR = tmp;
  env.TEMP = tmp;
  env.TMP = tmp;
  const proc = Bun.spawn(
    [
      process.execPath,
      SLOT,
      process.execPath,
      "-e",
      "console.log(process.env.FLIGHTDECK_SLOT_LOCK)",
    ],
    { env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), 15_000);
  const code = await proc.exited;
  clearTimeout(timer);
  expect((await new Response(proc.stdout).text()).trim()).toBe(join(tmp, "flightdeck-slot.lock"));
  expect(code).toBe(0);
});
