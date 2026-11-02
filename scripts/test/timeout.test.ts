import { expect, test } from "bun:test";
import { defaultTestTimeoutMs, testArgs } from "./timeout.ts";

test("a Windows runner gets three times the default timeout, every other platform keeps bun's 5 s", () => {
  expect(defaultTestTimeoutMs("win32")).toBe(15_000);
  expect(defaultTestTimeoutMs("linux")).toBe(5_000);
  expect(defaultTestTimeoutMs("darwin")).toBe(5_000);
});

test("the suite runs with --timeout, which every test file without its own setDefaultTimeout gets, then the user's arguments", () => {
  expect(testArgs("win32", [])).toEqual(["test", "--timeout=15000"]);
  expect(testArgs("linux", ["apps/daemon"])).toEqual(["test", "--timeout=5000", "apps/daemon"]);
});
