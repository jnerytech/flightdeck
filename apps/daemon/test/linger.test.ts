import { describe, expect, test } from "bun:test";
import { lingerState } from "../src/linger.ts";

const ctx = (platform: string, answer: { code: number; stdout: string }) => {
  const calls: string[][] = [];
  return {
    calls,
    ctx: {
      platform,
      user: "dev",
      exec: async (cmd: string[]) => {
        calls.push(cmd);
        return answer;
      },
    },
  };
};

describe("linger", () => {
  test("loginctl says yes or no for the user", async () => {
    const yes = ctx("linux", { code: 0, stdout: "Linger=yes\n" });
    expect(await lingerState(yes.ctx)).toBe("on");
    expect(yes.calls).toEqual([["loginctl", "show-user", "dev", "-p", "Linger"]]);
    expect(await lingerState(ctx("linux", { code: 0, stdout: "Linger=no\n" }).ctx)).toBe("off");
  });

  test("it does not apply off Linux, and a loginctl that fails or says something else is not a verdict", async () => {
    const win = ctx("win32", { code: 0, stdout: "Linger=no" });
    expect(await lingerState(win.ctx)).toBeNull();
    expect(win.calls).toEqual([]);
    expect(await lingerState(ctx("linux", { code: 1, stdout: "" }).ctx)).toBeNull();
    expect(await lingerState(ctx("linux", { code: 0, stdout: "???" }).ctx)).toBeNull();
  });
});
