import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { mcpShots } from "../../lib/shots/table-agent-mcp.ts";

const IDS = { project: "p1", projectName: "web" } as DemoIds;
const SHOTS = () => mcpShots(IDS);
const wire = (name: string) => SHOTS().find((shot) => shot.name === name)?.wire;

describe("the MCP tab prints (#4269)", () => {
  test("the table prints the empty, failed, loading, form, retype, test, result, remove and long-row states", () => {
    expect(SHOTS().map((shot) => shot.name)).toEqual([
      "agente-mcp-vazio",
      "agente-mcp-falhou",
      "agente-mcp-carregando",
      "agente-mcp-novo",
      "agente-mcp-novo-url",
      "agente-mcp-segredo",
      "agente-mcp-testar",
      "agente-mcp-teste-resultado",
      "agente-mcp-remover",
      "agente-mcp-linha-longa",
    ]);
  });

  test("each print opens the Agent screen of the demo's first project", () => {
    const routes = SHOTS().map((shot) => shot.route);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route).toMatchObject({ name: "agent", host: "demo-alfa", projectId: "p1" });
    }
  });

  test("the empty, failed and loading prints change the host's answer to the list", () => {
    expect(wire("agente-mcp-vazio")).toEqual([{ command: "mcp.list", data: { servers: [] } }]);
    expect(wire("agente-mcp-falhou")).toEqual([
      { command: "mcp.list", refuse: "The MCP servers could not be read." },
    ]);
    expect(wire("agente-mcp-carregando")).toEqual([{ command: "mcp.list", hold: true }]);
  });

  test("the test prints answer mcp.test in the page, so no server is ever started by a print", () => {
    for (const name of ["agente-mcp-testar", "agente-mcp-teste-resultado"]) {
      const rule = wire(name)?.find((r) => r.command === "mcp.test");
      expect(rule).toMatchObject({ command: "mcp.test", reply: expect.any(Object) });
    }
  });

  test("the test answer carries the preview that opens the dialog and the tools the result lists", () => {
    const rule = wire("agente-mcp-teste-resultado")?.find((r) => r.command === "mcp.test") as
      | { reply: { preview: { command: string }; tools: string[]; resources: string[] } }
      | undefined;
    expect({
      command: rule?.reply.preview.command,
      tools: (rule?.reply.tools.length ?? 0) > 0,
      resources: Array.isArray(rule?.reply.resources),
    }).toEqual({ command: "npx", tools: true, resources: true });
  });

  test("the long row's list holds one server whose command and badges are long", () => {
    const list = wire("agente-mcp-linha-longa")?.find((r) => r.command === "mcp.list") as
      | { data: { servers: Array<{ command?: string; readOnly: boolean }> } }
      | undefined;
    expect({
      count: list?.data.servers.length,
      longCommand: (list?.data.servers[0]?.command?.length ?? 0) > 120,
      readOnly: list?.data.servers[0]?.readOnly,
    }).toEqual({ count: 1, longCommand: true, readOnly: true });
  });

  test("the prints that open a form or a dialog on the seeded servers leave the host's answers alone, and never write", () => {
    for (const name of [
      "agente-mcp-novo",
      "agente-mcp-novo-url",
      "agente-mcp-segredo",
      "agente-mcp-remover",
    ]) {
      expect(wire(name)?.some((rule) => ["mcp.save", "mcp.remove"].includes(rule.command))).toBe(
        false,
      );
    }
  });

  test("the form, the test dialog and the long row are re-measured narrow", () => {
    expect(
      ["agente-mcp-novo", "agente-mcp-testar", "agente-mcp-linha-longa"].map(
        (name) => narrowSizes("dark", name).length,
      ),
    ).toEqual([3, 3, 3]);
  });
});
