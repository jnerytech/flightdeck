import { expect, test } from "bun:test";
import { defaultTestTimeoutMs, testArgs } from "./timeout.ts";

test("Linux and macOS get 15 s: a UI test's first render compiles the lazy screens inside the test, and a loaded runner passes bun's 5 s", () => {
  expect(defaultTestTimeoutMs("linux")).toBe(15_000);
  expect(defaultTestTimeoutMs("darwin")).toBe(15_000);
});

test("Windows gets 30 s: its runners are slower and 4 of 30 shard jobs timed out at 15 s on a different test each (#534)", () => {
  expect(defaultTestTimeoutMs("win32")).toBe(30_000);
});

test("the suite runs with --timeout, which every test file without its own setDefaultTimeout gets, then the user's arguments", () => {
  expect(testArgs("win32", [])).toEqual(["test", "--timeout=30000"]);
  expect(testArgs("linux", ["apps/daemon"])).toEqual(["test", "--timeout=15000", "apps/daemon"]);
});
