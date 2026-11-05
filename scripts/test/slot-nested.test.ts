import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SLOT = join(import.meta.dir, "../slot.ts");

test("slot-reentrant: a slot call made under the slot runs and finishes, with the real script and its own lock", async () => {
  const lock = join(mkdtempSync(join(tmpdir(), "fd-slot-nested-")), "slot.lock");
  // Without the rule the inner call waits for the lock the outer one holds: the test would hang.
  const proc = Bun.spawn([process.execPath, SLOT, process.execPath, SLOT, "echo", "nested ok"], {
    env: { ...process.env, FLIGHTDECK_SLOT_LOCK: lock, FLIGHTDECK_SLOT_HOLDER: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 15_000);
  const code = await proc.exited;
  clearTimeout(timer);
  expect(await new Response(proc.stdout).text()).toContain("nested ok");
  expect(code).toBe(0);
});
