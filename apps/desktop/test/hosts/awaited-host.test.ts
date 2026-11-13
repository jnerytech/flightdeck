import { describe, expect, test } from "bun:test";
import { awaitedHost } from "../../src/features/hosts/domain/awaited-host.ts";
import type { Route } from "../../src/lib/router.ts";

describe("awaitedHost", () => {
  test("the reader waits for the host of its transcript", () => {
    const route: Route = { name: "reader", target: { hostId: "pi", claudeSessionId: "c1" } };
    expect(awaitedHost(route)).toBe("pi");
  });

  test("a screen that reads from one host waits for that host", () => {
    const routes: Route[] = [
      { name: "external", host: "pi", claudeSessionId: "c1" },
      { name: "terminal", host: "pi", terminalId: "t1" },
      { name: "board", host: "pi", projectId: "p1" },
      { name: "auto-approvals", host: "pi" },
    ];
    expect(routes.map(awaitedHost)).toEqual(["pi", "pi", "pi", "pi"]);
  });

  test("a screen that spans the hosts waits for none", () => {
    const routes: Route[] = [{ name: "hub" }, { name: "costs" }, { name: "settings" }];
    expect(routes.map(awaitedHost)).toEqual([null, null, null]);
  });
});
