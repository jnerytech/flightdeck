import { describe, expect, test } from "bun:test";
import { exitWhenClosed } from "../../src/cli/exit.ts";

/** Fake deps that record what the command printed and the codes it exited with. */
function fakeDeps(exit: (code: number) => void = () => {}) {
  const codes: number[] = [];
  const errors: string[] = [];
  return {
    codes,
    errors,
    log: { log: () => {}, error: (m: string) => errors.push(m) },
    exit: (code: number) => {
      codes.push(code);
      exit(code);
    },
  };
}

/** How the promise `exitWhenClosed` returned ended: it must never reject, or the command's `void` leaves it unhandled. */
const outcome = (run: Promise<void>) =>
  run.then(
    () => "resolved",
    (error: Error) => `rejected: ${error.message}`,
  );

describe("cli-exit", () => {
  test("exits 0 when claude closes the transport", async () => {
    const deps = fakeDeps();
    expect(await outcome(exitWhenClosed(Promise.resolve(), deps))).toBe("resolved");
    expect(deps.codes).toEqual([0]);
  });

  test("a closed that rejects is printed and exits 1, with nothing left rejected", async () => {
    const deps = fakeDeps();
    expect(await outcome(exitWhenClosed(Promise.reject(new Error("pipe broke")), deps))).toBe(
      "resolved",
    );
    expect(deps.codes).toEqual([1]);
    expect(deps.errors).toEqual(["flightdeckd: pipe broke"]);
  });

  test("an exit that throws is printed and exits 1, with nothing left rejected", async () => {
    const deps = fakeDeps((code) => {
      if (code === 0) throw new Error("exit failed");
    });
    expect(await outcome(exitWhenClosed(Promise.resolve(), deps))).toBe("resolved");
    expect(deps.codes).toEqual([0, 1]);
    expect(deps.errors).toEqual(["flightdeckd: exit failed"]);
  });
});
