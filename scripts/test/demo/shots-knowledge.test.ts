import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { knowledgeShots, memoryShots } from "../../lib/shots/table-knowledge.ts";

const IDS = { project: "p1", projectName: "web", knowledgeProject: "k1" } as DemoIds;
const KNOWLEDGE = () => knowledgeShots(IDS);
const MEMORY = () => memoryShots(IDS);
const wire = (shots: ReturnType<typeof knowledgeShots>, name: string) =>
  shots.find((shot) => shot.name === name)?.wire;

describe("the Knowledge prints (#4236)", () => {
  test("the table prints the empty, failed, loading, create-refused, no-match, switch, cut, warned and busy states", () => {
    expect(KNOWLEDGE().map((shot) => shot.name)).toEqual([
      "projeto-conhecimento-vazio",
      "projeto-conhecimento-falhou",
      "projeto-conhecimento-carregando",
      "projeto-conhecimento-criar-erro",
      "projeto-conhecimento-sem-status",
      "projeto-conhecimento-indice-desligado",
      "projeto-conhecimento-indice-falhou",
      "projeto-conhecimento-cortada",
      "projeto-conhecimento-avisos",
      "projeto-conhecimento-ocupado",
    ]);
  });

  test("each print opens the project that holds the demo's library, on the demo's first host", () => {
    for (const shot of KNOWLEDGE()) {
      expect(shot.route).toMatchObject({ name: "project", host: "demo-alfa", projectId: "k1" });
    }
  });

  test("the empty, failed and loading prints change the host's answer to the list", () => {
    expect(wire(KNOWLEDGE(), "projeto-conhecimento-vazio")).toEqual([
      { command: "knowledge.list", data: { entries: [], truncated: false } },
    ]);
    expect(wire(KNOWLEDGE(), "projeto-conhecimento-falhou")).toEqual([
      { command: "knowledge.list", refuse: "The documents could not be read from this host." },
    ]);
    expect(wire(KNOWLEDGE(), "projeto-conhecimento-carregando")).toEqual([
      { command: "knowledge.list", hold: true },
    ]);
  });

  test("the create, switch and busy prints change the answer of the command they show", () => {
    const commands = (name: string) => (wire(KNOWLEDGE(), name) ?? []).map((rule) => rule.command);
    expect({
      create: commands("projeto-conhecimento-criar-erro"),
      off: commands("projeto-conhecimento-indice-desligado"),
      failed: commands("projeto-conhecimento-indice-falhou"),
      busy: commands("projeto-conhecimento-ocupado"),
    }).toEqual({
      create: ["knowledge.create"],
      off: ["knowledge.feed"],
      failed: ["knowledge.feed"],
      busy: ["knowledge.setStatus"],
    });
  });

  test("the cut and warned prints answer with a list of their own: one cut, one with a warning and a problem", () => {
    const list = (name: string) =>
      (
        wire(KNOWLEDGE(), name)?.find((rule) => rule.command === "knowledge.list") as
          | {
              data: {
                entries: Array<{ warnings: string[]; problems: string[] }>;
                truncated: boolean;
              };
            }
          | undefined
      )?.data;
    const cut = list("projeto-conhecimento-cortada");
    const warned = list("projeto-conhecimento-avisos");
    expect({
      cut: cut?.truncated,
      cutEntries: (cut?.entries.length ?? 0) > 0,
      warning: warned?.entries.some((entry) => entry.warnings.length > 0),
      problem: warned?.entries.some((entry) => entry.problems.length > 0),
    }).toEqual({ cut: true, cutEntries: true, warning: true, problem: true });
  });

  test("the prints that open the seeded library leave the host's answers as the seed gives them", () => {
    expect(wire(KNOWLEDGE(), "projeto-conhecimento-sem-status")).toBeUndefined();
  });

  test("the warned print and the create refusal are re-measured narrow", () => {
    expect(narrowSizes("dark", "projeto-conhecimento-avisos")).toHaveLength(3);
    expect(narrowSizes("dark", "projeto-conhecimento-criar-erro")).toHaveLength(3);
  });
});

describe("the Memory prints (#4236)", () => {
  test("the table prints the empty, failed, loading, name error, new file, edit, stale, save, delete and discard states", () => {
    expect(MEMORY().map((shot) => shot.name)).toEqual([
      "agente-memoria-vazio",
      "agente-memoria-falhou",
      "agente-memoria-carregando",
      "agente-memoria-nome-erro",
      "agente-memoria-novo",
      "agente-memoria-editado",
      "agente-memoria-desatualizado",
      "agente-memoria-salvar",
      "agente-memoria-excluir",
      "agente-memoria-descartar",
    ]);
  });

  test("each print opens the Agent screen of the demo's first project", () => {
    for (const shot of MEMORY()) {
      expect(shot.route).toMatchObject({ name: "agent", host: "demo-alfa", projectId: "p1" });
    }
  });

  test("the empty, failed and loading prints change the host's answer to the list", () => {
    expect(wire(MEMORY(), "agente-memoria-vazio")).toEqual([
      { command: "memory.list", data: { dir: "memory", exists: false, files: [] } },
    ]);
    expect(wire(MEMORY(), "agente-memoria-falhou")).toEqual([
      { command: "memory.list", refuse: "The memory could not be read." },
    ]);
    expect(wire(MEMORY(), "agente-memoria-carregando")).toEqual([
      { command: "memory.list", hold: true },
    ]);
  });

  test("the stale print refuses the write and answers the read with a file that changed on disk", () => {
    const rules = wire(MEMORY(), "agente-memoria-desatualizado") ?? [];
    expect(rules.map((rule) => rule.command).sort()).toEqual(["memory.read", "memory.write"]);
  });

  test("the prints that work on the seeded files leave the host's answers as the seed gives them", () => {
    for (const name of [
      "agente-memoria-nome-erro",
      "agente-memoria-novo",
      "agente-memoria-editado",
      "agente-memoria-salvar",
      "agente-memoria-excluir",
      "agente-memoria-descartar",
    ]) {
      const shot = MEMORY().find((one) => one.name === name);
      expect({ name, printed: shot !== undefined, wire: shot?.wire }).toEqual({
        name,
        printed: true,
        wire: undefined,
      });
    }
  });
});

describe("the prints never let a command that writes reach the host (#4236)", () => {
  /** The commands that change the demo's hosts: a print that shows them must answer in the page, or a pass would write. */
  const WRITES = ["knowledge.create", "knowledge.setStatus", "memory.write", "memory.delete"];

  test("a rule on a command that writes is a rejection, a stall or a reply: never a rewritten answer of the host", () => {
    const rules = [...KNOWLEDGE(), ...MEMORY()].flatMap((shot) =>
      (shot.wire ?? [])
        .filter((rule) => WRITES.includes(rule.command))
        .map((rule) => ({
          print: shot.name,
          kind: Object.keys(rule).filter((k) => k !== "command")[0],
        })),
    );
    expect(rules.filter((rule) => !["reject", "stall", "reply"].includes(rule.kind ?? ""))).toEqual(
      [],
    );
    expect(rules.map((rule) => rule.print).sort()).toEqual([
      "agente-memoria-desatualizado",
      "projeto-conhecimento-criar-erro",
      "projeto-conhecimento-ocupado",
    ]);
  });

  test("the create print rejects the title with its reason, and the busy print stalls the status change", () => {
    expect([
      wire(KNOWLEDGE(), "projeto-conhecimento-criar-erro"),
      wire(KNOWLEDGE(), "projeto-conhecimento-ocupado"),
    ]).toEqual([
      [{ command: "knowledge.create", reject: expect.stringContaining("already exists") }],
      [{ command: "knowledge.setStatus", stall: true }],
    ]);
  });
});
