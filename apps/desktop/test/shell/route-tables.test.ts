import { describe, expect, test } from "bun:test";
import { BOARD_ROUTES } from "../../src/app/board-routes.tsx";
import { PAGE_ROUTES } from "../../src/app/page-routes.tsx";
import { SESSION_ROUTES } from "../../src/app/session-routes.tsx";
import type { Route } from "../../src/lib/router.ts";

/** The routes route-screens.tsx and filtered-screen.tsx answer themselves, with no table entry. */
type DispatchedName =
  | "home"
  | "start"
  | "settings"
  | "add-host"
  | "teams"
  | "all-projects"
  | "costs"
  | "vault";
type TabledName =
  | keyof typeof SESSION_ROUTES
  | keyof typeof BOARD_ROUTES
  | keyof typeof PAGE_ROUTES;

// A route that no table and no dispatcher branch names makes this line a type error.
const everyRouteHasAnOwner: [Exclude<Route["name"], TabledName | DispatchedName>] extends [never]
  ? true
  : never = true;
// A route named both by a table and by the dispatcher would never reach its table.
const noRouteHasTwoOwners: [Extract<TabledName, DispatchedName>] extends [never] ? true : never =
  true;

describe("route tables: each route name has exactly one builder", () => {
  test("no route name is in two tables, and the types name an owner for every route", () => {
    const names = [
      ...Object.keys(SESSION_ROUTES),
      ...Object.keys(BOARD_ROUTES),
      ...Object.keys(PAGE_ROUTES),
    ];
    expect(new Set(names).size).toBe(names.length);
    expect(everyRouteHasAnOwner && noRouteHasTwoOwners).toBe(true);
  });
});
