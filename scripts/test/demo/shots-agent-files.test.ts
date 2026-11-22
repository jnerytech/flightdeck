import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { contextShots, filesShots } from "../../lib/shots/table-agent-files.ts";
import type { WireRule } from "../../lib/shots/wire.ts";

const IDS = { project: "p1", projectName: "web" } as DemoIds;
const ALL = () => [...filesShots(IDS), ...contextShots(IDS)];
const wire = (name: string): WireRule[] => ALL().find((shot) => shot.name === name)?.wire ?? [];
const rule = (name: string, command: string) => wire(name).find((r) => r.command === command);
const kindsOf = (name: string, command: string) =>
  Object.keys(rule(name, command) ?? {}).filter((key) => key !== "command");

describe("the Files and Context tab prints (#4269)", () => {
  test("the tables print the empty, failed, bad-name, discard, stale and saved file states and the empty, cut and failed context", () => {
    expect(ALL().map((shot) => shot.name)).toEqual([
      "agente-claude-md-vazio",
      "agente-agentes-falhou",
      "agente-skills-nome-invalido",
      "agente-agentes-descartar",
      "agente-agentes-obsoleto",
      "agente-agentes-salvo",
      "agente-contexto-vazio",
      "agente-contexto-cortado",
      "agente-contexto-falhou",
    ]);
  });

  test("each print opens the Agent screen of the demo's first project", () => {
    const routes = ALL().map((shot) => shot.route);
    expect(routes).toHaveLength(9);
    for (const route of routes) {
      expect(route).toMatchObject({ name: "agent", host: "demo-alfa", projectId: "p1" });
    }
  });

  test("the empty and failed file lists change the host's answer to agentcfg.list", () => {
    expect(wire("agente-claude-md-vazio")).toEqual([
      { command: "agentcfg.list", data: { items: [] } },
    ]);
    expect(kindsOf("agente-agentes-falhou", "agentcfg.list")).toEqual(["refuse"]);
  });

  test("the empty, cut and failed context change the host's answer to memory.budget", () => {
    const sources = (name: string) =>
      (rule(name, "memory.budget") as { data: { sources: unknown[] } } | undefined)?.data.sources
        .length;
    expect({
      empty: sources("agente-contexto-vazio"),
      cut: (sources("agente-contexto-cortado") ?? 0) > 0,
      failed: kindsOf("agente-contexto-falhou", "memory.budget"),
    }).toEqual({ empty: 0, cut: true, failed: ["refuse"] });
  });

  test("the cut context lists the lines and the files left out, cut by lines", () => {
    const memory = (
      rule("agente-contexto-cortado", "memory.budget") as
        | {
            data: {
              memory: { cutBy: string | null; leftOutLines: string[]; leftOutFiles: string[] };
            };
          }
        | undefined
    )?.data.memory;
    expect({
      cutBy: memory?.cutBy,
      lines: (memory?.leftOutLines.length ?? 0) > 0,
      files: (memory?.leftOutFiles.length ?? 0) > 0,
    }).toEqual({ cutBy: "lines", lines: true, files: true });
  });

  test("every print that edits a file refuses the write in the page, but the saved one, which answers it in the page", () => {
    expect({
      bad: kindsOf("agente-skills-nome-invalido", "agentcfg.write"),
      discard: kindsOf("agente-agentes-descartar", "agentcfg.write"),
      stale: kindsOf("agente-agentes-obsoleto", "agentcfg.write"),
      saved: kindsOf("agente-agentes-salvo", "agentcfg.write"),
    }).toEqual({
      bad: ["reject"],
      discard: ["reject"],
      stale: ["reject"],
      saved: ["reply"],
    });
  });

  test("the stale print reads the file twice and the second answer has another hash", () => {
    const read = rule("agente-agentes-obsoleto", "agentcfg.read") as
      | { data: { hash: string }; after: { hash: string; content: string } }
      | undefined;
    expect({
      differs: read !== undefined && read.data.hash !== read.after.hash,
      changed: (read?.after.content.length ?? 0) > 0,
    }).toEqual({ differs: true, changed: true });
  });

  test("the bad-name, discard, stale and cut-context prints are re-measured narrow", () => {
    expect(
      [
        "agente-skills-nome-invalido",
        "agente-agentes-descartar",
        "agente-agentes-obsoleto",
        "agente-contexto-cortado",
      ].map((name) => narrowSizes("dark", name).length),
    ).toEqual([3, 3, 3, 3]);
  });
});
