import { describe, expect, test } from "bun:test";
import { has83Names } from "./short-path-probe.ts";

describe("short-path-probe: a volume without 8.3 names skips the 8.3 tests instead of failing them", () => {
  const long = "C:\\Users\\runner\\executavel-com-nome-bem-longo\\flightdeckd.exe";

  test("a short form that differs from the long path means 8.3 names are on", () => {
    expect(has83Names(() => "C:\\Users\\RUNNER~1\\EXECUT~1\\FLIGHT~1.EXE", long)).toBe(true);
  });

  test("a short form equal to the long path (fsutil 8dot3name disabled) means they are off", () => {
    expect(has83Names((path) => path, long)).toBe(false);
  });

  test("a path that is already short proves nothing, so it is not a reason to run the tests", () => {
    expect(has83Names((path) => path, "C:\\a.exe")).toBe(false);
  });
});
