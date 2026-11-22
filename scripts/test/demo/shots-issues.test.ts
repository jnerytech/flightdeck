import { describe, expect, test } from "bun:test";
import type { Issue } from "@flightdeck/protocol";
import type { DemoIds } from "../../demo-seed.ts";
import { issuesShots } from "../../lib/shots/table-issues.ts";

const IDS = { project: "p1", emptyProject: "p2", projectName: "web" } as DemoIds;
const SHOTS = () => issuesShots(IDS);
const byName = (name: string) => SHOTS().find((shot) => shot.name === name);
/** The issues a print's `issues.list` rule answers. */
const listOf = (name: string): Issue[] => {
  const rule = byName(name)?.wire?.find((r) => r.command === "issues.list");
  return rule && "data" in rule ? ((rule.data as { issues?: Issue[] }).issues ?? []) : [];
};

describe("the Issues panel and missing-tool prints (#4099)", () => {
  test("the table prints the panel's states and the start screen's tool cards", () => {
    expect(SHOTS().map((shot) => shot.name)).toEqual([
      "issues-lista",
      "issues-vazia",
      "issues-falha",
      "issues-conectar",
      "issues-configurar",
      "issues-configurar-azure",
      "issues-contagem",
      "issues-contagem-filtro",
      "issues-filtro-vazio",
      "issues-cortada",
      "issues-titulo-longo",
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

  test("the count prints answer a list of twelve, and the cut print a full page of fifty marked truncated (#4259)", () => {
    for (const name of ["issues-contagem", "issues-contagem-filtro", "issues-filtro-vazio"]) {
      expect(listOf(name)).toHaveLength(12);
      expect(byName(name)?.route).toMatchObject({ name: "board", projectId: "p1" });
    }
    const cut = byName("issues-cortada")?.wire?.[0];
    expect(cut && "data" in cut ? (cut.data as { truncated?: boolean }).truncated : null).toBe(
      true,
    );
    expect(listOf("issues-cortada")).toHaveLength(50);
  });

  test("the long-title print answers one issue whose title has no space to break at (#4259)", () => {
    const [issue] = listOf("issues-titulo-longo");
    expect(issue?.title.length).toBeGreaterThan(80);
    expect(issue?.title.includes(" ")).toBe(false);
  });

  test("every issue a print answers is whole: ref, author, labels and an external flag", () => {
    for (const name of ["issues-contagem", "issues-cortada", "issues-titulo-longo"]) {
      expect(listOf(name).length).toBeGreaterThan(0);
      for (const issue of listOf(name)) {
        expect(issue.ref.startsWith("github:")).toBe(true);
        expect(issue.author.length).toBeGreaterThan(0);
        expect(Array.isArray(issue.labels)).toBe(true);
        expect(typeof issue.external).toBe("boolean");
      }
    }
  });
});
