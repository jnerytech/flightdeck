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
});
