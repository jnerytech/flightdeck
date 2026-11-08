import { describe, expect, test } from "bun:test";
import { DOMAINS, HANDLERS } from "../src/server/handlers/index.ts";

describe("server-registry", () => {
  test("no command has a handler in two domains, and the registry holds every domain's", () => {
    const owners = new Map<string, string[]>();
    for (const [domain, handlers] of Object.entries(DOMAINS)) {
      for (const command of Object.keys(handlers)) {
        owners.set(command, [...(owners.get(command) ?? []), domain]);
      }
    }
    const twice = [...owners].filter(([, domains]) => domains.length > 1);
    expect(twice).toEqual([]);
    expect(Object.keys(HANDLERS).sort()).toEqual([...owners.keys()].sort());
  });

  // Issue #1288: the sign-in with GitHub and the board sync left the switch of server.ts.
  test("the github domain owns the github.* and boardsync.* commands", () => {
    expect(Object.keys(DOMAINS.github ?? {}).sort()).toEqual(
      [
        "boardsync.boards",
        "boardsync.link",
        "boardsync.log",
        "boardsync.setMap",
        "boardsync.setPush",
        "boardsync.status",
        "boardsync.syncNow",
        "boardsync.unlink",
        "github.issues",
        "github.login.cancel",
        "github.login.start",
        "github.logout",
        "github.repos",
        "github.start",
        "github.status",
      ].sort(),
    );
  });
});
