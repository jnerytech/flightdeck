import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { FlightdeckError } from "../src/errors.ts";
import { createKnowledgeDoc } from "../src/knowledge/create.ts";
import { listKnowledge } from "../src/knowledge/list.ts";
import { tempDir } from "./helpers.ts";

/** Issue #1039: a new library document from a template. */
const posix = process.platform !== "win32";
const project = () => realpathSync.native(tempDir("fd-kcreate-"));
const reasonOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error instanceof FlightdeckError ? error.reason : String(error);
  }
  return "created";
};

describe("knowledge-create: a document from a template (#1039)", () => {
  test("each kind goes in its own folder and reads back as a transitional document with the title and type", async () => {
    const root = project();
    const made = [
      await createKnowledgeDoc(root, "adr", "Use SQLite"),
      await createKnowledgeDoc(root, "rfc", "Move to the outbox"),
      await createKnowledgeDoc(root, "prd", "Card pins"),
    ];
    expect(made.map((e) => [e.path, e.type, e.status, e.title, e.problems])).toEqual([
      ["docs/adr/0001-use-sqlite.md", "adr", "transitional", "Use SQLite", []],
      ["docs/rfc/0001-move-to-the-outbox.md", "rfc", "transitional", "Move to the outbox", []],
      ["docs/prd/card-pins.md", "prd", "transitional", "Card pins", []],
    ]);
    // What the list shows later is what was returned.
    const listed = (await listKnowledge(root)).entries.map((e) => e.path).sort();
    expect(listed).toEqual(made.map((e) => e.path).sort());
  });

  test("an ADR or an RFC takes the next number of its folder, whatever else is there", async () => {
    const root = project();
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    for (const name of ["0001-a.md", "0003-b.md", "notes.md", "0002-c.txt", "9-short.md"]) {
      writeFileSync(join(root, "docs/adr", name), "# x\n");
    }
    mkdirSync(join(root, "docs/rfc"), { recursive: true });
    writeFileSync(join(root, "docs/rfc/0007-z.md"), "# z\n");
    const adr = await createKnowledgeDoc(root, "adr", "Next one");
    const rfc = await createKnowledgeDoc(root, "rfc", "Next one");
    expect([adr.path, rfc.path]).toEqual([
      "docs/adr/0004-next-one.md",
      "docs/rfc/0008-next-one.md",
    ]);
  });

  test("the file name is the title in plain ASCII: accents folded, symbols dropped, cut at 60", async () => {
    const root = project();
    const names = [
      (await createKnowledgeDoc(root, "prd", "Decisão rápida: Ação!")).path,
      (await createKnowledgeDoc(root, "prd", `  Spaces   and --- dashes  `)).path,
      (await createKnowledgeDoc(root, "prd", "x".repeat(100))).path,
    ];
    expect(names).toEqual([
      "docs/prd/decisao-rapida-acao.md",
      "docs/prd/spaces-and-dashes.md",
      `docs/prd/${"x".repeat(60)}.md`,
    ]);
  });

  test("a PRD named like a Windows device gets a suffix so the file is a real one", async () => {
    const root = project();
    const paths = [
      (await createKnowledgeDoc(root, "prd", "CON")).path,
      (await createKnowledgeDoc(root, "prd", "nul")).path,
      (await createKnowledgeDoc(root, "prd", "Com1")).path,
      (await createKnowledgeDoc(root, "prd", "lpt9")).path,
      (await createKnowledgeDoc(root, "prd", "console")).path,
    ];
    expect(paths).toEqual([
      "docs/prd/con-doc.md",
      "docs/prd/nul-doc.md",
      "docs/prd/com1-doc.md",
      "docs/prd/lpt9-doc.md",
      "docs/prd/console.md",
    ]);
    expect(readdirSync(join(root, "docs/prd")).sort()).toEqual(
      ["con-doc.md", "com1-doc.md", "console.md", "lpt9-doc.md", "nul-doc.md"].sort(),
    );
  });

  test("a title with no letter or digit is refused and nothing is written", async () => {
    const root = project();
    const reasons = [
      await reasonOf(() => createKnowledgeDoc(root, "adr", "   ")),
      await reasonOf(() => createKnowledgeDoc(root, "adr", "!!! ???")),
      await reasonOf(() => createKnowledgeDoc(root, "adr", "\n\t")),
    ];
    expect(reasons).toEqual([
      "knowledge_title_invalid",
      "knowledge_title_invalid",
      "knowledge_title_invalid",
    ]);
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  test("a body replaces the template's sections, and is text only: front matter and control characters in it do nothing", async () => {
    const root = project();
    const body =
      "---\nstatus: valid\n---\r\n## Context\r\nWe chose SQLite.\u0000\u0007\n\n## Decision\tkept\n\n";
    const entry = await createKnowledgeDoc(root, "adr", "Use SQLite", body);
    const text = readFileSync(join(root, entry.path), "utf8");
    expect([entry.status, entry.title, text]).toEqual([
      "transitional",
      "Use SQLite",
      "---\nstatus: transitional\n---\n# Use SQLite\n\n---\nstatus: valid\n---\n## Context\nWe chose SQLite.\n\n## Decision\tkept\n",
    ]);
  });

  test("a body carries no invisible character: direction marks, zero-width and tag characters are dropped", async () => {
    const root = project();
    const body = "a\u202Eb\u200Bc\u{E0041}d\u2028e\uFE0F\u2066";
    const entry = await createKnowledgeDoc(root, "adr", "Hidden", body);
    expect(readFileSync(join(root, entry.path), "utf8")).toBe(
      "---\nstatus: transitional\n---\n# Hidden\n\nabcd\ne\n",
    );
  });

  test("a body of invisible characters only is the template", async () => {
    const root = project();
    const entry = await createKnowledgeDoc(root, "adr", "Hidden", "\u200B\u202E\u{E0041} ");
    expect(readFileSync(join(root, entry.path), "utf8")).toContain("## Decision");
  });

  test("a blank body is the template", async () => {
    const root = project();
    const entry = await createKnowledgeDoc(root, "adr", "Use SQLite", " \n\t ");
    expect(readFileSync(join(root, entry.path), "utf8")).toContain("## Consequences");
  });

  test("the title goes only into the heading, on one line: front matter written in a title stays text", async () => {
    const root = project();
    const entry = await createKnowledgeDoc(root, "adr", "Plain\n---\nstatus: valid\n---\nmore");
    const text = readFileSync(join(root, entry.path), "utf8");
    expect([
      entry.status,
      entry.problems,
      text.startsWith("---\nstatus: transitional\n---\n# "),
    ]).toEqual(["transitional", [], true]);
    const heading = text.split("\n").filter((line) => line.startsWith("# "));
    expect(heading).toEqual(["# Plain --- status: valid --- more"]);
  });

  test("a document of that name is never overwritten", async () => {
    const root = project();
    const first = await createKnowledgeDoc(root, "prd", "Same title");
    writeFileSync(join(root, first.path), "mine, edited\n");
    const reason = await reasonOf(() => createKnowledgeDoc(root, "prd", "Same title"));
    expect([reason, readFileSync(join(root, first.path), "utf8")]).toEqual([
      "knowledge_exists",
      "mine, edited\n",
    ]);
    expect(readdirSync(join(root, "docs/prd"))).toEqual(["same-title.md"]);
  });

  test("a folder that is a link, or sits behind one, is not written through", async () => {
    if (!posix) return;
    const root = project();
    const outside = project();
    mkdirSync(join(root, "docs"), { recursive: true });
    symlinkSync(outside, join(root, "docs/adr"));
    const viaFolder = await reasonOf(() => createKnowledgeDoc(root, "adr", "Out"));
    const other = project();
    symlinkSync(outside, join(other, "docs"));
    const viaDocs = await reasonOf(() => createKnowledgeDoc(other, "rfc", "Out"));
    expect([viaFolder, viaDocs, readdirSync(outside)]).toEqual([
      "knowledge_folder_unsafe",
      "knowledge_folder_unsafe",
      [],
    ]);
  });
});
