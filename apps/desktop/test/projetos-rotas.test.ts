import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import type { AppState } from "../src/lib/app-store.ts";
import { breadcrumb } from "../src/lib/breadcrumb.ts";
import { activeNav } from "../src/lib/nav-active.ts";
import { Router } from "../src/lib/router.ts";
import { tabKind } from "../src/lib/tab-badge.ts";

const state = {
  hosts: [{ id: "h1", name: "alfa" }],
  projects: { h1: [{ id: "p1", name: "api" }] },
} as unknown as AppState;
const en = translator("en");
const pt = translator("pt-BR");

describe("projetos-rotas: the Projects screens are routes", () => {
  test("both belong to the Projects item of the sidebar, and a tab of either shows its icon", () => {
    expect(activeNav({ name: "all-projects" })).toBe("projects");
    expect(activeNav({ name: "project", host: "h1", projectId: "p1" })).toBe("projects");
    expect(tabKind({ name: "all-projects" })).toBe("projects");
    expect(tabKind({ name: "project", host: "h1", projectId: "p1" })).toBe("projects");
  });

  test("the header names them in both languages: Projects, then the project", () => {
    expect(breadcrumb({ name: "all-projects" }, state, en)).toEqual([{ label: "Projects" }]);
    expect(breadcrumb({ name: "all-projects" }, state, pt)).toEqual([{ label: "Projetos" }]);
    expect(breadcrumb({ name: "project", host: "h1", projectId: "p1" }, state, en)).toEqual([
      { label: "Projects", route: { name: "all-projects" } },
      { label: "api" },
    ]);
  });

  test("an unknown project shows its id, and the router keeps the pair apart", () => {
    expect(breadcrumb({ name: "project", host: "h1", projectId: "zz" }, state, en)[1]).toEqual({
      label: "zz",
    });
    const router = new Router({ name: "all-projects" });
    router.push({ name: "project", host: "h1", projectId: "p1" });
    router.back();
    expect(router.current).toEqual({ name: "all-projects" });
  });
});
