import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { issuesShots } from "../../lib/shots/table-issues.ts";

const IDS = { project: "p1", emptyProject: "p2", projectName: "web" } as DemoIds;
const SHOTS = () => issuesShots(IDS);
const byName = (name: string) => SHOTS().find((shot) => shot.name === name);

describe("the Issues panel and missing-tool prints (#4099)", () => {
  test("the table prints the panel's five states and the start screen's tool cards", () => {
    expect(SHOTS().map((shot) => shot.name)).toEqual([
      "issues-lista",
      "issues-vazia",
      "issues-falha",
      "issues-conectar",
      "issues-configurar",
      "ferramentas-cartoes",
      "ferramentas-dispensada",
    ]);
  });

  test("the panel opens on the web board, the not-connected one on the project with no issues provider", () => {
    for (const name of ["issues-lista", "issues-vazia", "issues-falha", "issues-configurar"]) {
      expect(byName(name)?.route).toMatchObject({
        name: "board",
        host: "demo-alfa",
        projectId: "p1",
      });
    }
    expect(byName("issues-conectar")?.route).toMatchObject({
      name: "board",
      host: "demo-alfa",
      projectId: "p2",
    });
  });

  test("the empty list and the failed list are answers the page fakes for issues.list", () => {
    expect(byName("issues-vazia")?.wire).toEqual([
      { command: "issues.list", data: { issues: [] } },
    ]);
    const failed = byName("issues-falha")?.wire?.[0];
    expect(failed).toMatchObject({ command: "issues.list" });
    expect(failed && "refuse" in failed ? failed.refuse.length : 0).toBeGreaterThan(0);
  });

  test("the tool cards open from the host page and answer deps.check with a required and an optional tool missing", () => {
    for (const name of ["ferramentas-cartoes", "ferramentas-dispensada"]) {
      expect(byName(name)?.route).toMatchObject({ name: "host", host: "demo-alfa" });
      const rule = byName(name)?.wire?.[0];
      expect(rule).toMatchObject({ command: "deps.check" });
      const items =
        rule && "data" in rule
          ? (rule.data as { items: Array<{ group: string; state: string }> }).items
          : [];
      expect(
        items
          .filter((i) => i.state === "missing")
          .map((i) => i.group)
          .sort(),
      ).toEqual(["optional", "required"]);
    }
  });
});
