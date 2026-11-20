import { describe, expect, test } from "bun:test";
import { resolveProject } from "../../src/daemon-client/index.ts";

const PROJECTS = [
  { id: "p1", name: "api" },
  { id: "p2", name: "Web" },
];

const refusal = (ref: ReturnType<typeof resolveProject>) =>
  "refusal" in ref ? { code: ref.refusal.code, text: ref.refusal.err.join("\n") } : null;

describe("resolveProject (issue #3457)", () => {
  test("an id wins, and a name matches without regard to case", () => {
    expect(resolveProject(PROJECTS, "p2")).toEqual({ id: "p2", name: "Web" });
    expect(resolveProject(PROJECTS, "API")).toEqual({ id: "p1", name: "api" });
  });

  test("an id is taken before a name that spells the same", () => {
    const tricky = [
      { id: "p1", name: "p2" },
      { id: "p2", name: "other" },
    ];
    expect(resolveProject(tricky, "p2")).toEqual({ id: "p2", name: "other" });
  });

  test("no name on a host with one project is that project", () => {
    expect(resolveProject([{ id: "p1", name: "api" }], undefined)).toEqual({
      id: "p1",
      name: "api",
    });
  });

  test("no name on a host with several projects is refused with their names", () => {
    const refused = refusal(resolveProject(PROJECTS, undefined));
    expect(refused?.code).toBe(1);
    expect(refused?.text).toContain("--project");
    expect(refused?.text).toContain("api, Web");
  });

  test("no name on a host with no projects says so", () => {
    expect(refusal(resolveProject([], undefined))).toEqual({
      code: 1,
      text: "this host has no projects yet",
    });
  });

  test("a name that two projects share is refused with the ids, never guessed", () => {
    const twins = [
      { id: "p1", name: "api" },
      { id: "p2", name: "API" },
    ];
    const refused = refusal(resolveProject(twins, "api"));
    expect(refused?.code).toBe(1);
    expect(refused?.text).toContain("p1, p2");
  });

  test("an unknown name is refused with the projects there are", () => {
    const refused = refusal(resolveProject(PROJECTS, "ghost"));
    expect(refused?.code).toBe(1);
    expect(refused?.text).toContain("ghost");
    expect(refused?.text).toContain("api, Web");
  });
});
