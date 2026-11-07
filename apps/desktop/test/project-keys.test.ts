import { describe, expect, test } from "bun:test";
import type { Project } from "@flightdeck/protocol";
import { projectLabels } from "../src/lib/costs.ts";
import { knownProjectKeys, ProjectKeys } from "../src/lib/project-keys.ts";

const ALFA = "host:alfa:/work/docs-site";
const BETA = "host:beta:/srv/docs-site";

// Issue #881: one project, one label on every screen.
describe("project-keys: the keys the app has seen", () => {
  test("a new key is kept and heard, a key already seen changes nothing", () => {
    const keys = new ProjectKeys();
    let heard = 0;
    const stop = keys.subscribe(() => heard++);
    expect(keys.version).toBe(0);
    keys.note([ALFA, BETA]);
    expect(keys.all()).toEqual([ALFA, BETA]);
    expect([keys.version, heard]).toEqual([1, 1]);
    keys.note([BETA, ALFA]);
    expect([keys.version, heard]).toEqual([1, 1]);
    keys.note([BETA, "github.com/x/y"]);
    expect(keys.all()).toEqual([ALFA, BETA, "github.com/x/y"]);
    expect([keys.version, heard]).toEqual([2, 2]);
    stop();
    keys.note(["another"]);
    expect(heard).toBe(2);
  });

  test("the registered projects of every host give their keys, and a host that sends none gives none", () => {
    const project = (projectKey?: string) => ({ projectKey }) as unknown as Project;
    expect(
      knownProjectKeys({
        h1: [project(ALFA), project(undefined)],
        h2: [project(BETA), project(ALFA)],
        h3: [],
      }),
    ).toEqual([ALFA, BETA]);
  });
});

describe("project-keys: a name on two hosts carries its host wherever it is shown", () => {
  test("a project shown alone is told apart against the keys known elsewhere", () => {
    expect(projectLabels([ALFA]).get(ALFA)).toBe("docs-site");
    expect(projectLabels([ALFA], [BETA]).get(ALFA)).toBe("docs-site · alfa");
  });

  test("the same keys give the same labels whichever screen asks, and only the asked keys are returned", () => {
    const home = projectLabels([ALFA], [ALFA, BETA]);
    const costs = projectLabels([BETA, ALFA], [ALFA, BETA]);
    expect(home.get(ALFA)).toBe(costs.get(ALFA));
    expect([...home.keys()]).toEqual([ALFA]);
    expect(costs.get(BETA)).toBe("docs-site · beta");
  });

  test("a key known twice is one project, and a lone name keeps its short label", () => {
    expect(projectLabels([ALFA, ALFA], [ALFA]).get(ALFA)).toBe("docs-site");
    expect(projectLabels(["host:alfa:/a/web"], [ALFA, BETA]).get("host:alfa:/a/web")).toBe("web");
  });
});
