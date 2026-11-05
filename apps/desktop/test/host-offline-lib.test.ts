import { describe, expect, test } from "bun:test";
import { hostUptime, mayBeRefusedAddress, offlineHint } from "../src/lib/host-offline.ts";

describe("host-offline", () => {
  test("the uptime ages with the time since host.info arrived and never goes backwards", () => {
    expect(hostUptime(5, 1_000, 1_000)).toBe(5);
    expect(hostUptime(5, 1_000, 61_000)).toBe(65);
    expect(hostUptime(5, 1_000, 61_999)).toBe(65);
    expect(hostUptime(5, 10_000, 1_000)).toBe(5);
  });

  test("a refused connection to a loopback or Linux host gets the Linux hint, other kinds the generic one", () => {
    expect(offlineHint("refused", "ws://127.0.0.1:7430/v1/ws", null)).toBe("linux");
    expect(offlineHint("refused", "ws://localhost:7430/v1/ws", null)).toBe("linux");
    expect(offlineHint("refused", "ws://100.64.0.9:7430/v1/ws", "linux")).toBe("linux");
    expect(offlineHint("refused", "ws://100.64.0.9:7430/v1/ws", "win32")).toBe("generic");
    expect(offlineHint("timeout", "ws://127.0.0.1:7430/v1/ws", "linux")).toBe("generic");
    expect(offlineHint("lost", "ws://127.0.0.1:7430/v1/ws", "linux")).toBe("generic");
  });

  test("an address that does not parse falls back on the OS the host last reported", () => {
    expect(offlineHint("refused", "not an address", "linux")).toBe("linux");
    expect(offlineHint("refused", "not an address", "win32")).toBe("generic");
    expect(offlineHint("refused", "not an address", null)).toBe("generic");
  });

  test("a refused connection to a non-loopback address may be the daemon refusing this machine", () => {
    expect(mayBeRefusedAddress("refused", "ws://100.64.0.9:7430/v1/ws")).toBe(true);
    expect(mayBeRefusedAddress("refused", "ws://192.168.3.155:7420/v1/ws")).toBe(true);
    expect(mayBeRefusedAddress("refused", "ws://127.0.0.1:7430/v1/ws")).toBe(false);
    expect(mayBeRefusedAddress("refused", "ws://localhost:7430/v1/ws")).toBe(false);
    expect(mayBeRefusedAddress("timeout", "ws://100.64.0.9:7430/v1/ws")).toBe(false);
    expect(mayBeRefusedAddress("lost", "ws://100.64.0.9:7430/v1/ws")).toBe(false);
  });

  test("an address that does not parse gives no refused-address hint", () => {
    expect(mayBeRefusedAddress("refused", "not an address")).toBe(false);
  });
});
