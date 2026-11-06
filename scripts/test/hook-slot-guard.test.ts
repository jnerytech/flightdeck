import { describe, expect, test } from "bun:test";
import { slotViolation } from "../lib/claude-hooks.ts";

const outside = (command: string) => slotViolation(command, {});

describe("hook-slot-guard", () => {
  test("a heavy run outside the slot is blocked and names the slot command", () => {
    for (const command of [
      "bun run test",
      "bun run test -- --bail",
      "cd ../flightdeck-fase39 && bun run e2e",
      "bun run demo:shots",
      "bun run smoke",
      "bun run smoke:boardsync",
      "bun run build:desktop",
      "bun run build:daemon",
      "bun run coverage",
      "bun test",
      "env -u CLAUDECODE bun test --bail",
      "nice bun run test",
    ]) {
      const reason = outside(command) ?? "";
      expect(reason).toContain("is heavy");
      expect(reason).toContain("bun run slot --");
    }
    expect(outside("bun run e2e") ?? "").toContain("bun run slot -- bun run e2e");
  });

  test("the same runs through the slot, and the light ones, pass", () => {
    for (const command of [
      "bun run slot -- bun run test",
      "bun run slot -- --priority bun run test",
      "FLIGHTDECK_SLOT_LABEL=fd-harness bun run slot -- --nice bun run e2e",
      "bun run slot -- --status",
      "bun run test:related",
      "bun --config=bunfig.area.toml test scripts/test/slot.test.ts",
      "bun test scripts/test/slot.test.ts",
      "bun run typecheck && bun run lint",
      "bun run demo",
      'echo "bun run test" > notes.txt',
      "git commit -m 'chore: bun run test is heavy'",
    ]) {
      expect(outside(command)).toBeNull();
    }
  });

  test("a session that already runs under the slot's holder may run them directly", () => {
    expect(slotViolation("bun run test", { FLIGHTDECK_SLOT_HOLDER: "4242" })).toBeNull();
    expect(slotViolation("bun run test", { FLIGHTDECK_SLOT_HOLDER: "" }) ?? "").toContain(
      "is heavy",
    );
  });
});
