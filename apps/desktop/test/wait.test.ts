import { expect, describe as suite, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { plainWaiter, settleMaybe, settlePlain, WaitTimeout, waiter } from "./wait.ts";

registerDom();

const never = Boolean(process.env.FD_NEVER_SET_THIS);

suite("wait: a wait that runs out of time throws and says what it waited for", () => {
  test("it returns once the check holds", async () => {
    let n = 0;
    await settlePlain(() => ++n >= 3, 1000);
    expect(n).toBe(3);
  });

  test("on timeout it throws WaitTimeout with the timeout and the check's own source", async () => {
    const error = await settlePlain(() => never, 60).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WaitTimeout);
    expect((error as Error).message).toBe("timeout (60 ms) waiting for: () => never");
  });

  test("a label given by the test replaces the source", async () => {
    const error = await settlePlain(() => false, 40, "the host to be online").catch(
      (e: unknown) => e,
    );
    expect((error as Error).message).toBe("timeout (40 ms) waiting for: the host to be online");
  });

  test("a waiter keeps the default timeout its file had, and an explicit one wins", async () => {
    const quick = plainWaiter(30);
    const started = Date.now();
    await expect(quick(() => false)).rejects.toThrow("timeout (30 ms)");
    expect(Date.now() - started).toBeLessThan(1000);
    await expect(quick(() => false, 50)).rejects.toThrow("timeout (50 ms)");
  });

  test("the act version waits inside act, so React has flushed when it returns", async () => {
    const wait = waiter(1000);
    let n = 0;
    await wait(() => ++n >= 2);
    expect(n).toBe(2);
    await expect(waiter(30)(() => false)).rejects.toThrow("timeout (30 ms)");
  });

  test("settleMaybe says whether the condition held, and never throws", async () => {
    expect(await settleMaybe(() => true, 50)).toBe(true);
    expect(await settleMaybe(() => false, 30)).toBe(false);
  });
});
