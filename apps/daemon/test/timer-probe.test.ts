import { describe, expect, test } from "bun:test";
import { fileOfStack } from "./timer-probe.ts";

describe("timer-probe: the file that started a timer", () => {
  test("it reads the first frame under apps/daemon/src on a POSIX stack", () => {
    const stack = [
      "Error",
      "    at fileOf (/repo/apps/daemon/test/timer-probe.ts:20:5)",
      "    at start (/repo/apps/daemon/src/costs/budgets.ts:88:12)",
      "    at main (/repo/apps/daemon/src/main.ts:10:3)",
    ].join("\n");
    expect(fileOfStack(stack)).toBe("costs/budgets.ts");
  });

  test("it reads the same frame on a Windows stack, whose paths use backslashes", () => {
    const stack = [
      "Error",
      "      at fileOf (D:\\a\\flightdeck\\flightdeck\\apps\\daemon\\test\\timer-probe.ts:20:5)",
      "      at start (D:\\a\\flightdeck\\flightdeck\\apps\\daemon\\src\\costs\\budgets.ts:88:12)",
    ].join("\n");
    expect(fileOfStack(stack)).toBe("costs/budgets.ts");
    expect(fileOfStack("    at x (C:\\r\\apps\\daemon\\src\\main.ts:1:1)")).toBe("main.ts");
  });

  test("a frame without a position, and a stack with no daemon frame, are read too", () => {
    expect(fileOfStack("    at /repo/apps/daemon/src/server.ts")).toBe("server.ts");
    expect(fileOfStack("Error\n    at x (/repo/apps/daemon/test/a.ts:1:1)")).toBeNull();
    expect(fileOfStack("")).toBeNull();
  });
});
