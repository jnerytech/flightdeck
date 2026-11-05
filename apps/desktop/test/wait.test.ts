import { expect, describe as suite, test } from "bun:test";
import { notLinux } from "../../../scripts/test/not-linux.ts";
import { registerDom } from "./dom.ts";
import {
  plainWaiter,
  settleMaybe,
  settlePlain,
  stays,
  uiIdle,
  WaitTimeout,
  waiter,
} from "./wait.ts";

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

suite("wait: stays checks that a thing does NOT happen, by watching for the whole window", () => {
  // unstable: #288 it counts polls in an 80 ms window, and a loaded runner can poll only twice
  test.skipIf(notLinux)(
    "it returns once the window ended with the check holding the whole time",
    async () => {
      let n = 0;
      await stays(() => {
        n += 1;
        return true;
      }, 80);
      expect(n).toBeGreaterThan(2);
    },
  );

  test("it throws the moment the check breaks, naming what was meant to hold", async () => {
    let n = 0;
    const error = await stays(() => ++n < 3, 1000, "the dialog stays closed").catch(
      (e: unknown) => e,
    );
    expect((error as Error).message).toBe("broke before 1000 ms: the dialog stays closed");
    expect(n).toBe(3);
  });
});

suite("wait: uiIdle returns once the screen has stopped changing, not after a guessed time", () => {
  test("it waits through a screen that keeps changing and returns after the last change", async () => {
    let lastChange = 0;
    let stop = false;
    const timer = setInterval(() => {
      document.body.textContent = String(Date.now());
      lastChange = Date.now();
    }, 15);
    setTimeout(() => {
      stop = true;
      clearInterval(timer);
    }, 150);
    await uiIdle();
    expect(stop).toBe(true);
    expect(Date.now() - lastChange).toBeGreaterThanOrEqual(30);
  });

  test("a screen that never settles throws, naming the wait", async () => {
    const timer = setInterval(() => {
      document.body.textContent = String(Math.random());
    }, 5);
    const error = await uiIdle(40, 200).catch((e: unknown) => e);
    clearInterval(timer);
    expect((error as Error).message).toBe(
      "timeout (200 ms) waiting for: the screen to stop changing",
    );
  });
});
