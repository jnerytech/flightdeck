import { describe, expect, test } from "bun:test";
import { ROUTE_NAMES } from "../src/lib/router.ts";

describe("conexoes-ui: the route", () => {
  test("the Conexões route is one a stored tab may carry, so its tab survives a restart", () => {
    expect(ROUTE_NAMES.has("connections")).toBe(true);
  });
});
