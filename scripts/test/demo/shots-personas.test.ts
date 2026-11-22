import { describe, expect, test } from "bun:test";
import { Persona } from "@flightdeck/protocol";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { personaShots } from "../../lib/shots/table-personas.ts";
import type { WireRule } from "../../lib/shots/wire.ts";

const IDS = { project: "p1", projectName: "flightdeck-web" } as DemoIds;
const named = (name: string) => personaShots(IDS).find((shot) => shot.name === name);
const rule = (name: string, command: string): WireRule | undefined =>
  named(name)?.wire?.find((r) => r.command === command);
const listed = (name: string) => {
  const found = rule(name, "personas.list");
  return found && "data" in found ? (found.data as { personas: unknown[] }) : undefined;
};

describe("the Personas prints (#4215)", () => {
  test("the table prints the editor, the rows' states, the dialogs, the notices and the empty states, in order", () => {
    expect(personaShots(IDS).map((shot) => shot.name)).toEqual([
      "personas-editor-existing",
      "personas-editor-errors",
      "personas-untrusted",
      "personas-modified",
      "personas-project",
      "personas-remove",
      "personas-reset",
      "personas-publish",
      "personas-refused",
      "personas-published",
      "personas-failed",
      "personas-empty",
      "personas-no-host",
    ]);
  });

  test("every print opens the Personas screen", () => {
    expect(new Set(personaShots(IDS).map((shot) => shot.route.name))).toEqual(
      new Set(["personas"]),
    );
  });

  test("the rows' lists are real personas of the protocol: an untrusted project one, an edited pack one and a trusted project one", () => {
    const parsed = (name: string) =>
      (listed(name)?.personas ?? []).map((p) => Persona.safeParse(p).success);
    expect([
      parsed("personas-untrusted"),
      parsed("personas-modified"),
      parsed("personas-project"),
    ]).toEqual([
      [true, true, true],
      [true, true, true],
      [true, true],
    ]);
    const rows = (name: string) =>
      (listed(name)?.personas ?? []) as Array<{
        trusted: boolean;
        modified: boolean;
        scope: string;
      }>;
    expect({
      untrusted: rows("personas-untrusted").filter((p) => !p.trusted).length,
      modified: rows("personas-modified").filter((p) => p.modified).length,
      projectScope: rows("personas-project").every((p) => p.scope === "project"),
    }).toEqual({ untrusted: 1, modified: 1, projectScope: true });
  });

  test("the refusal print leaves Trust to the host, which has no such file; a failed read, the empty list and the missing host change the answer", () => {
    expect([
      rule("personas-refused", "personas.trust"),
      rule("personas-failed", "personas.list"),
      listed("personas-empty")?.personas,
      rule("personas-no-host", "host.info"),
    ]).toEqual([
      undefined,
      { command: "personas.list", refuse: "The host's personas could not be read." },
      [],
      { command: "host.info", without: { features: ["personas"] } },
    ]);
  });

  test("a publish is answered in the page, so no file is written on the demo host", () => {
    expect(rule("personas-published", "personas.publishAgent")).toEqual({
      command: "personas.publishAgent",
      reply: { path: ".claude/agents/persona-release-notes.md" },
    });
  });

  test("the list, the editors and the untrusted row are re-measured narrow", () => {
    expect(
      ["personas", "personas-editor-existing", "personas-editor-errors", "personas-untrusted"].map(
        (name) => narrowSizes("dark", name).length,
      ),
    ).toEqual([3, 3, 3, 3]);
  });
});
