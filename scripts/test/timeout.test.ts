import { expect, test } from "bun:test";
import { defaultTestTimeoutMs } from "./timeout.ts";

test("a Windows runner gets three times the default timeout, every other platform keeps bun's 5 s", () => {
  expect(defaultTestTimeoutMs("win32")).toBe(15_000);
  expect(defaultTestTimeoutMs("linux")).toBe(5_000);
  expect(defaultTestTimeoutMs("darwin")).toBe(5_000);
});
