import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { changesShots } from "../../lib/shots/table-changes.ts";

const IDS = { project: "p1", diffCard: "c1", idleSession: "s1" } as DemoIds;
const shots = changesShots(IDS);
const names = shots.map((shot) => shot.name);

/** The states of the Changes tab the prints did not show (#4229), as the issue lists them. */
const STATES = [
  "card-mudancas-reverter",
  "card-mudancas-desfazer",
  "card-mudancas-editor",
  "card-mudancas-conflito",
  "card-mudancas-editor-recusado",
  "card-mesclar-merge",
  "card-mesclar",
  "card-mesclar-recusado",
  "card-pr-comentarios",
  "card-pr-comentarios-vazio",
  "card-pr-comentarios-falhou",
  "card-mudancas-comentario-editando",
  "card-mudancas-enviados",
  "card-mudancas-arquivos",
  "card-mudancas-falhou",
  "card-mudancas-vazio",
];

describe("the Changes states' prints (#4229)", () => {
  test("every state of the issue has a print of its own", () => {
    expect(STATES.filter((name) => !names.includes(name))).toEqual([]);
  });

  test("no name is printed twice", () => {
    expect(names.length).toBe(new Set(names).size);
  });

  test("a state the host cannot be left in is a wire rule, so the demo's hosts stay as they are", () => {
    const wired = ["card-mudancas-falhou", "card-mudancas-vazio", "card-mudancas-arquivos"];
    expect(
      wired.filter((name) => (shots.find((shot) => shot.name === name)?.wire?.length ?? 0) === 0),
    ).toEqual([]);
  });
});

/** Runs a print's `prepare` on a page that records each call and answers with itself. */
async function calls(name: string): Promise<string> {
  const seen: string[] = [];
  const text = (arg: unknown): string => {
    if (arg instanceof RegExp || typeof arg === "string") return String(arg);
    if (typeof arg === "object" && arg !== null) return Object.values(arg).map(text).join(",");
    return typeof arg;
  };
  const member = (call: string): unknown =>
    new Proxy(
      (...args: unknown[]) => {
        seen.push(`${call}(${args.map(text).join(",")})`);
        return recorder;
      },
      { get: (_target, prop) => (recorder as Record<string | symbol, unknown>)[prop] },
    );
  const recorder: unknown = new Proxy(() => recorder, {
    // `then` stays undefined, or awaiting the recorder would wait for it forever.
    get: (_target, prop) => (prop === "then" ? undefined : member(String(prop))),
  });
  await shots.find((shot) => shot.name === name)?.prepare?.(recorder as never);
  return seen.join(" ");
}

const wireOf = (name: string) => shots.find((shot) => shot.name === name)?.wire ?? [];

describe("what each Changes state's print does on the page (#4229)", () => {
  test("every print opens the Changes tab and waits for what it shows before the shot", async () => {
    const opened = await Promise.all(
      STATES.map(async (name) => [name, (await calls(name)).includes("Changes")]),
    );
    expect(opened.filter(([, ok]) => !ok).map(([name]) => name)).toEqual([]);
    expect(
      (
        await Promise.all(STATES.map(async (name) => (await calls(name)).includes("waitFor")))
      ).every(Boolean),
    ).toBe(true);
  });

  test("the Undo offer is the page's own answer to the revert, so the host's file stays", async () => {
    expect(wireOf("card-mudancas-desfazer")).toEqual([
      {
        command: "changes.revert",
        reply: { path: "fake-1.txt", undoUntil: "{in 25s}" },
      },
    ]);
    expect(await calls("card-mudancas-desfazer")).toMatch(/Revert file.*Undo/);
  });

  test("the conflict is a save with the wrong hash, which the host refuses, and the editor offers Reload", async () => {
    expect(wireOf("card-mudancas-conflito").map((r) => r.command)).toEqual(["file.read"]);
    expect(await calls("card-mudancas-conflito")).toMatch(/type\(three\).*Save.*Reload from disk/);
  });

  test("the merge dialog picks squash and writes a message; the refused one confirms it and waits for the alert", async () => {
    // The dialog opens in merge-commit mode; the other print only opens it.
    expect(await calls("card-mesclar-merge")).not.toMatch(/check\(\)/);
    expect(await calls("card-mesclar")).toMatch(/check\(\).*fill\(Fix the cart total\)/);
    expect(wireOf("card-mesclar-recusado").map((r) => r.command)).toEqual([
      "changes.get",
      "card.mergeLocal",
    ]);
    expect(await calls("card-mesclar-recusado")).toMatch(
      /Merge and archive.*Merge and archive.*alert/,
    );
  });

  test("the PR comments come from the page's wire: a list with an outside author, none, and a refusal", () => {
    // Answered in the page: the demo's fake gh has no answer for the PR's comments, and a refused
    // host answer would not be rewritten.
    const list = wireOf("card-pr-comentarios").find((r) => r.command === "pr.comments");
    const comments = (list && "reply" in list ? list.reply : { comments: [] }) as {
      comments: Array<{ authorAssociation: string | null }>;
    };
    expect(comments.comments.some((c) => c.authorAssociation === "NONE")).toBe(true);
    expect(wireOf("card-pr-comentarios-vazio")[0]).toEqual({
      command: "pr.comments",
      reply: { comments: [] },
    });
    expect(wireOf("card-pr-comentarios-falhou")[0]).toMatchObject({
      command: "pr.comments",
      reject: expect.any(String),
    });
    // The PR card has no worktree, so its diff is answered in the page too.
    for (const name of [
      "card-pr-comentarios",
      "card-pr-comentarios-vazio",
      "card-pr-comentarios-falhou",
    ]) {
      expect(wireOf(name).find((r) => r.command === "changes.get")).toHaveProperty("reply");
    }
  });

  test("the file-kind print lists a binary, a hidden and a too-large file, each with no lines", () => {
    const rule = wireOf("card-mudancas-arquivos")[0];
    const files = (rule && "data" in rule ? rule.data : { files: [] }) as {
      files: Array<{ binary: boolean; secret?: boolean; tooLarge?: boolean; hunks: unknown[] }>;
    };
    expect([
      files.files.some((f) => f.binary),
      files.files.some((f) => f.secret),
      files.files.some((f) => f.tooLarge),
    ]).toEqual([true, true, true]);
  });

  test("the failed and the empty prints answer the read with a refusal and with no file", () => {
    expect(wireOf("card-mudancas-falhou")[0]).toMatchObject({
      command: "changes.get",
      refuse: expect.any(String),
    });
    const empty = wireOf("card-mudancas-vazio")[0];
    expect(empty && "data" in empty ? (empty.data as { files: unknown[] }).files : null).toEqual(
      [],
    );
  });

  test("the comment prints edit a draft and show the sent history from the same list", async () => {
    expect(wireOf("card-mudancas-comentario-editando").map((r) => r.command)).toEqual([
      "changes.get",
      "review.list",
    ]);
    expect(await calls("card-mudancas-comentario-editando")).toMatch(/Edit the comment on/);
    expect(await calls("card-mudancas-enviados")).toMatch(/Sent/);
  });

  test("the editor prints open the file's editor; the refused one refuses the read", async () => {
    expect(await calls("card-mudancas-editor")).toMatch(/Edit file/);
    expect(wireOf("card-mudancas-editor-recusado")[0]).toMatchObject({ command: "file.read" });
    expect(await calls("card-mudancas-reverter")).toMatch(/Revert.*alertdialog/);
  });
});
