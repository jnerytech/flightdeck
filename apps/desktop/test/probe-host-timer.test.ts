import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { probeHost } from "../src/lib/probe-host.ts";

describe("probe-host-timer: the probe's own time limit, with the clock in the test's hands", () => {
  test("when the limit passes the probe gives up with the timeout reason, and its timer is cleared", async () => {
    const cleared: unknown[] = [];
    let fire: (() => void) | null = null;
    const pending = probeHost("ws://127.0.0.1:1/v1/ws", "t", translator("en"), {
      timer: {
        set: (fn) => {
          fire = fn;
          return "handle";
        },
        clear: (handle) => cleared.push(handle),
      },
    });
    (fire as (() => void) | null)?.();
    const result = await pending;
    expect(result).toEqual({ ok: false, error: translator("en")("hostForm.probeTimeout") });
    expect(cleared).toEqual(["handle"]);
  });
});
