import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { timelineShots } from "../../lib/shots/table-timeline.ts";
import { type WireRule, wireRewriter } from "../../lib/shots/wire.ts";

const IDS = { rewindSession: "rw" } as DemoIds;
const shots = () => timelineShots(IDS);
const named = (name: string) => shots().find((shot) => shot.name === name);
const rule = (name: string, command: string): WireRule | undefined =>
  named(name)?.wire?.find((r) => r.command === command);

/** A page that records each call and answers with itself, also for `page.mouse.move(...)`. */
async function calls(name: string): Promise<string[]> {
  const seen: string[] = [];
  const text = (arg: unknown): string => {
    if (arg instanceof RegExp || typeof arg === "string") return String(arg);
    if (typeof arg === "object" && arg !== null) return Object.values(arg).map(text).join(",");
    return typeof arg;
  };
  const member = (member: string): unknown =>
    new Proxy(
      (...args: unknown[]) => {
        seen.push(`${member}(${args.map(text).join(",")})`);
        return recorder;
      },
      { get: (_target, prop) => (recorder as Record<string | symbol, unknown>)[prop] },
    );
  const recorder: unknown = new Proxy(() => recorder, {
    get: (_target, prop) => (prop === "then" ? undefined : member(String(prop))),
  });
  await named(name)?.prepare?.(recorder as never);
  return seen;
}

// #4252: the Timeline sheet and its dialogs have states the prints did not show (a refused preview, a
// refused apply, nothing to rewind, a refused files read, the Undo dialog, a long prompt).
describe("the Timeline prints (#4252)", () => {
  test("the table prints the Rewind dialog's refusals, the files read that failed, the Undo dialog and the long prompt, in order", () => {
    expect(shots().map((shot) => shot.name)).toEqual([
      "linha-do-tempo-voltar-recusa",
      "linha-do-tempo-voltar-recusa-aplicar",
      "linha-do-tempo-voltar-nada",
      "linha-do-tempo-voltar-lista-longa",
      "linha-do-tempo-arquivos-falhou",
      "linha-do-tempo-desfazer",
      "linha-do-tempo-desfazer-recusa",
      "linha-do-tempo-prompt-longo",
      "linha-do-tempo-prompt-longo-aberto",
    ]);
  });

  test("every print opens the session that has turns", () => {
    expect(
      shots().map((shot) => (shot.route.name === "session" ? shot.route.id : shot.route.name)),
    ).toEqual(Array(9).fill("rw"));
  });

  test("the Rewind refusals change the preview's answer and the apply's, which is answered in the page so no file goes back; nothing to rewind is an empty preview", () => {
    expect(rule("linha-do-tempo-voltar-recusa", "rewind.preview")).toEqual({
      command: "rewind.preview",
      refuse: expect.stringContaining("snapshots"),
    });
    expect(rule("linha-do-tempo-voltar-recusa-aplicar", "rewind.apply")).toEqual({
      command: "rewind.apply",
      reject: expect.stringContaining("rewound"),
    });
    expect(rule("linha-do-tempo-voltar-nada", "rewind.preview")).toEqual({
      command: "rewind.preview",
      data: { via: "snapshot", files: [], insertions: 0, deletions: 0 },
    });
  });

  // #4374: a rewind that touches more files than fit in the dialog's list box.
  test("the long list print answers the rewind preview with about 25 files, past the list's height", () => {
    const found = rule("linha-do-tempo-voltar-lista-longa", "rewind.preview");
    const files = (
      found && "data" in found ? (found.data as { files: Array<{ path: string }> }) : { files: [] }
    ).files;
    expect(files.length).toBeGreaterThanOrEqual(25);
    expect(new Set(files.map((file) => file.path)).size).toBe(files.length);
  });

  test("the files read that fails is a refused snapshots.files", () => {
    expect(rule("linha-do-tempo-arquivos-falhou", "snapshots.files")).toEqual({
      command: "snapshots.files",
      refuse: expect.stringContaining("snapshot"),
    });
  });

  test("the Undo dialog reads the undo preview from a read that lists files; the refused one answers the dialog's read with a refusal after the sheet's own read lists them", () => {
    const listed = rule("linha-do-tempo-desfazer", "rewind.undoPreview");
    expect(listed).toEqual({
      command: "rewind.undoPreview",
      as: "snapshots.list",
      data: expect.objectContaining({ via: "snapshot", files: expect.any(Array) }),
    });
    expect(rule("linha-do-tempo-desfazer-recusa", "rewind.undoPreview")).toMatchObject({
      ...(listed as Record<string, unknown>),
      afterRefuse: expect.stringContaining("snapshot"),
    });
  });

  test("the long-prompt prints list two turns, each a before and an after, the last prompt past the clamp", () => {
    const list = rule("linha-do-tempo-prompt-longo", "snapshots.list");
    const snapshots = (
      (list && "data" in list ? list.data : null) as {
        snapshots: Array<{ kind: string; tree: string; prompt: string | null }>;
      }
    ).snapshots;
    expect(snapshots.map((row) => row.kind)).toEqual(["before", "after", "before", "after"]);
    // A turn that changed files has an `after` tree unlike its `before` one.
    const [first, firstEnd, second, secondEnd] = snapshots;
    expect([first?.tree !== firstEnd?.tree, second?.tree !== secondEnd?.tree]).toEqual([
      true,
      true,
    ]);
    expect((second?.prompt ?? "").length).toBeGreaterThan(300);
    expect(rule("linha-do-tempo-prompt-longo-aberto", "snapshots.list")).toEqual(list);
  });

  test("each print waits for the state it shows before it is taken", async () => {
    const waits: Array<[string, string[]]> = [
      ["linha-do-tempo-voltar-recusa", ["Try again"]],
      ["linha-do-tempo-voltar-recusa-aplicar", ["Rewind files", "Could not rewind the files"]],
      ["linha-do-tempo-voltar-nada", ["Nothing to rewind", "Nada para voltar"]],
      ["linha-do-tempo-voltar-lista-longa", ["Rewind files", "Files this rewind changes"]],
      ["linha-do-tempo-arquivos-falhou", ["Could not read the files of turn", "Try again"]],
      ["linha-do-tempo-desfazer", ["Undo rewind", "Undo the rewind"]],
      ["linha-do-tempo-desfazer-recusa", ["Undo rewind", "Could not work out what the undo"]],
      ["linha-do-tempo-prompt-longo", ["Show more"]],
      ["linha-do-tempo-prompt-longo-aberto", ["Show more", "Show less"]],
    ];
    for (const [name, needles] of waits) {
      const seen = (await calls(name)).join("\n");
      expect([name, needles.filter((needle) => !seen.includes(needle))]).toEqual([name, []]);
    }
  });

  test("the sheet, the refused apply, the long list, the files that failed, the Undo dialog and the open prompt are re-measured narrow", () => {
    expect(
      [
        "linha-do-tempo",
        "linha-do-tempo-voltar-recusa-aplicar",
        "linha-do-tempo-voltar-lista-longa",
        "linha-do-tempo-arquivos-falhou",
        "linha-do-tempo-desfazer",
        "linha-do-tempo-prompt-longo-aberto",
      ].map((name) => narrowSizes("dark", name).length),
    ).toEqual([3, 3, 3, 3, 3, 3]);
  });
});

describe("a rule that refuses after its first answer (#4252)", () => {
  const ask = (id: string) => JSON.stringify({ id, type: "rewind.undoPreview", payload: {} });
  const ack = (id: string) => JSON.stringify({ type: "ack", id, ok: true, data: { files: [] } });
  const rules: WireRule[] = [
    {
      command: "rewind.undoPreview",
      as: "snapshots.list",
      data: { via: "snapshot", files: [{ path: "a.ts", change: "modified" }] },
      afterRefuse: "The snapshots could not be read.",
    },
  ];

  test("the first answer carries the data and a later one is refused with the text", () => {
    const wire = wireRewriter(rules);
    const answers = ["r1", "r2"].map((id) => {
      wire.fromApp(ask(id));
      return JSON.parse(wire.fromHost(ack(id))) as Record<string, unknown>;
    });
    expect(answers).toEqual([
      {
        type: "ack",
        id: "r1",
        ok: true,
        data: { via: "snapshot", files: [{ path: "a.ts", change: "modified" }] },
      },
      {
        type: "ack",
        id: "r2",
        ok: false,
        error: { code: "unavailable", message: "The snapshots could not be read." },
      },
    ]);
  });
});
