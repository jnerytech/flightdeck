import { describe, expect, test } from "bun:test";
import {
  Card,
  type ColumnContract,
  Command,
  type ContractOverrides,
  contractOf,
  DAEMON_REASONS,
  DEFAULT_CONTRACTS,
  ErrorCode,
  missingFor,
  PINNED_DOCS_MAX,
  Project,
  pinnedDocProblem,
  specExpectedPath,
  specPathProblem,
} from "../src/index.ts";

const card = (
  over: Partial<{
    description: string;
    prUrl: string | null;
    checksState: never;
    validationNote: string | null;
    specState: { path: string; found: boolean; heading: string | null } | null;
    specPath: string | null;
    slug: string | null;
  }>,
) => ({
  description: "",
  prUrl: null,
  checksState: null,
  validationNote: null,
  specState: null,
  specPath: null,
  slug: null,
  ...over,
});

describe("board-contracts: what a column asks of a card", () => {
  test("by default In progress hints at criteria and Review confirms a PR and its checks", () => {
    expect(DEFAULT_CONTRACTS.in_progress).toEqual({ enforce: "hint", checks: ["criteria"] });
    expect(DEFAULT_CONTRACTS.review).toEqual({ enforce: "confirm", checks: ["pr", "checks"] });
    expect(contractOf("backlog")).toBeNull();
    expect(contractOf("done")).toBeNull();
  });

  test("a project's contract wins over the default, a column it leaves out keeps the default", () => {
    const mine: ColumnContract = { enforce: "confirm", checks: ["criteria"] };
    expect(contractOf("done", { done: mine })).toEqual(mine);
    expect(contractOf("review", { done: mine })).toEqual(DEFAULT_CONTRACTS.review ?? null);
  });

  test("a checklist item is the acceptance criteria", () => {
    expect(missingFor("in_progress", card({ description: "plan" }))).toEqual(["criteria"]);
    expect(missingFor("in_progress", card({ description: "- [ ] one" }))).toEqual([]);
    expect(missingFor("in_progress", card({ description: "* [x] done thing" }))).toEqual([]);
  });

  test("Review lacks a PR first; its checks only count once there is a PR", () => {
    expect(missingFor("review", card({}))).toEqual(["pr"]);
    expect(missingFor("review", card({ prUrl: "https://x/pr/1" }))).toEqual([]);
    const pending = card({ prUrl: "https://x/pr/1", checksState: "pending" as never });
    const failing = card({ prUrl: "https://x/pr/1", checksState: "failing" as never });
    const passing = card({ prUrl: "https://x/pr/1", checksState: "passing" as never });
    expect(missingFor("review", pending)).toEqual(["checksPending"]);
    expect(missingFor("review", failing)).toEqual(["checksFailing"]);
    expect(missingFor("review", passing)).toEqual([]);
    expect(missingFor("review", card({ checksState: "failing" as never }))).toEqual(["pr"]);
  });

  test("a column that asks nothing lacks nothing, and an override can turn a column off", () => {
    expect(missingFor("backlog", card({}))).toEqual([]);
    expect(missingFor("review", card({}), { review: { enforce: "confirm", checks: [] } })).toEqual(
      [],
    );
  });
});

describe("board-contracts: the wire", () => {
  test("a project carries contractByColumn, empty when an older daemon sends none", () => {
    const base = {
      id: "p",
      path: "/r",
      name: "r",
      baseBranch: "main",
      prProvider: "none",
      setupScript: null,
      promptTemplate: "",
    };
    expect(Project.parse(base).contractByColumn).toEqual({});
    const withOne = Project.parse({
      ...base,
      contractByColumn: { review: { enforce: "hint", checks: ["pr"] } },
    });
    expect(withOne.contractByColumn.review).toEqual({ enforce: "hint", checks: ["pr"] });
  });

  test("project.update takes contractByColumn, and null gives a column back to the default", () => {
    const parsed = Command.safeParse({
      type: "project.update",
      id: "1",
      payload: {
        projectId: "p",
        contractByColumn: { review: null, done: { enforce: "confirm", checks: ["pr"] } },
      },
    });
    expect(parsed.success).toBe(true);
    const bad = Command.safeParse({
      type: "project.update",
      id: "1",
      payload: { projectId: "p", contractByColumn: { review: { enforce: "never", checks: [] } } },
    });
    expect(bad.success).toBe(false);
  });

  test("card.move takes force, and the refusal has its own code and reasons", () => {
    const move = Command.safeParse({
      type: "card.move",
      id: "1",
      payload: { cardId: "c", column: "review", force: true },
    });
    expect(move.success).toBe(true);
    expect(ErrorCode.options).toContain("contract_unmet");
    expect(DAEMON_REASONS).toContain("card_contract_unmet");
    expect(DAEMON_REASONS).toContain("card_moved_anyway");
  });
});

describe("board-contracts: the validation note (issue #78, slice 3a)", () => {
  const asks: ContractOverrides = { review: { enforce: "confirm", checks: ["validation"] } };

  test("a column can ask for a validation note, and a blank one does not count", () => {
    expect(missingFor("review", card({}), asks)).toEqual(["validation"]);
    expect(missingFor("review", card({ validationNote: "   " }), asks)).toEqual(["validation"]);
    expect(missingFor("review", card({ validationNote: "ran it by hand" }), asks)).toEqual([]);
    // No column asks for it unless a project says so.
    expect(missingFor("review", card({ prUrl: "https://x/pr/1" }))).toEqual([]);
  });

  test("it is asked in the order the contract lists it", () => {
    const both: ContractOverrides = {
      review: { enforce: "confirm", checks: ["validation", "pr"] },
    };
    expect(missingFor("review", card({}), both)).toEqual(["validation", "pr"]);
  });

  test("a card carries validationNote, empty for an older daemon, and card.update sets or clears it", () => {
    const base = {
      id: "c",
      projectId: "p",
      title: "t",
      description: "",
      column: "backlog",
      columnLocked: false,
      position: 1,
      slug: null,
      branch: null,
      worktreePath: null,
      prUrl: null,
      prState: null,
      checksState: null,
      queued: false,
      sessionId: null,
      sessionStatus: null,
      notice: null,
      discarded: false,
      runs: [],
      createdAt: "2026-11-07T10:00:00Z",
      updatedAt: "2026-11-07T10:00:00Z",
    };
    expect(Card.safeParse(base).success).toBe(true);
    expect(Card.parse(base).validationNote).toBeNull();
    expect(Card.parse({ ...base, validationNote: "done by hand" }).validationNote).toBe(
      "done by hand",
    );
    const update = (validationNote: unknown) =>
      Command.safeParse({
        type: "card.update",
        id: "1",
        payload: { cardId: "c", validationNote },
      }).success;
    expect(update("ran it")).toBe(true);
    expect(update(null)).toBe(true);
    expect(update("x".repeat(4001))).toBe(false);
  });
});

describe("board-contracts: the spec artifact (issue #78, slice 3b)", () => {
  const asks: ContractOverrides = { review: { enforce: "confirm", checks: ["spec"] } };
  const withSpec = (found: boolean, heading: string | null = null, path = "docs/specs/x.md") => ({
    ...card({ slug: "x" }),
    specState: { path, found, heading },
  });

  test("a column can ask for a spec: it lacks one until the worktree has the file", () => {
    expect(missingFor("review", card({ slug: "x" }), asks)).toEqual(["spec"]);
    expect(missingFor("review", withSpec(false), asks)).toEqual(["spec"]);
    expect(missingFor("review", withSpec(true), asks)).toEqual([]);
    expect(missingFor("review", withSpec(true, "A heading"), asks)).toEqual([]);
    // No column asks for it unless a project says so.
    expect(missingFor("review", card({ prUrl: "https://x/pr/1" }))).toEqual([]);
  });

  test("a spec path is relative to the worktree and stays inside it", () => {
    for (const ok of ["docs/specs/x.md", "x.md", "a/b/c.md", "docs/specs/ação.md", "a b/c d.md"]) {
      expect(specPathProblem(ok)).toBeNull();
    }
    for (const bad of [
      "",
      "/etc/passwd.md",
      "\\\\host\\share\\x.md",
      "C:\\x.md",
      "c:/x.md",
      "../x.md",
      "a/../../x.md",
      "a/..\\..\\x.md",
      "..",
      "docs/specs/x.txt",
      "docs/specs/x",
      "x\u0000.md",
      "x\n.md",
      `${"a/".repeat(100)}x.md`,
      "docs//x.md",
      "./x.md",
      "docs/./x.md",
      "docs/specs/",
    ]) {
      expect(typeof specPathProblem(bad)).toBe("string");
    }
  });

  test("a pinned document is a plain Markdown path inside one of the library's folders", () => {
    for (const ok of [
      "docs/adr/0001-use-sqlite.md",
      "docs/decisions/2026-11-08-x.md",
      "docs/specs/login/flow.md",
      "docs/rfc/a b.md",
      "docs/prd/ação.md",
    ]) {
      expect(pinnedDocProblem(ok)).toBeNull();
    }
    for (const bad of [
      "README.md",
      "docs/adr",
      "docs/adr/x.txt",
      "docs/other/x.md",
      "docs/adrs/x.md",
      "docs/ADR/x.md",
      "../docs/adr/x.md",
      "docs/adr/../../secret.md",
      "/docs/adr/x.md",
      "C:\\docs\\adr\\x.md",
      "docs/adr/x\u0000.md",
      // line breaks and direction marks past the ASCII controls
      "docs/adr/x\u0085.md",
      "docs/adr/x\u2028y.md",
      "docs/adr/x\u202ey.md",
    ]) {
      expect(typeof pinnedDocProblem(bad)).toBe("string");
    }
  });

  test("card.update takes at most ten pinned documents, each a library path", () => {
    const update = (pinnedDocs: unknown) =>
      Command.safeParse({ type: "card.update", id: "1", payload: { cardId: "c", pinnedDocs } })
        .success;
    const many = (n: number) => Array.from({ length: n }, (_, i) => `docs/adr/${i}.md`);
    expect([
      update([]),
      update(["docs/adr/0001-a.md"]),
      update(many(PINNED_DOCS_MAX)),
      update(many(PINNED_DOCS_MAX + 1)),
      update(["README.md"]),
      update("docs/adr/a.md"),
    ]).toEqual([true, true, true, false, false, false]);
  });

  test("what was found counts only for the path the card names now", () => {
    // Found at the default path, then the card named another: the old finding says nothing.
    const moved = { ...withSpec(true), specPath: "notes/mine.md" };
    expect(missingFor("review", moved, asks)).toEqual(["spec"]);
    expect(
      missingFor(
        "review",
        { ...moved, specState: { ...moved.specState, path: "notes/mine.md" } },
        asks,
      ),
    ).toEqual([]);
    // No slug and no path: nothing to be found.
    expect(missingFor("review", { ...withSpec(true), slug: null }, asks)).toEqual(["spec"]);
    expect(specExpectedPath({ specPath: null, slug: "login" })).toBe("docs/specs/login.md");
    expect(specExpectedPath({ specPath: "a.md", slug: "login" })).toBe("a.md");
    expect(specExpectedPath({ specPath: null, slug: null })).toBeNull();
  });

  test("a path Windows would read as a device, a stream or a trimmed name is refused", () => {
    for (const bad of [
      "docs/a:b.md",
      "con.md",
      "docs/NUL.md",
      "aux.md",
      "docs/com1.md",
      "LPT9.md",
      "docs/prn.x.md",
      "docs/name .md/x.md",
      "docs/dot./x.md",
      "docs/space /x.md",
      "conin$.md",
      "docs/CONOUT$.md",
      "com\u00b9.md",
      "docs/LPT\u00b2.x.md",
      "conin$.md",
      "docs/CONOUT$.md",
      "com\u00b9.md",
      "docs/LPT\u00b2.x.md",
    ]) {
      expect(typeof specPathProblem(bad)).toBe("string");
    }
    for (const ok of ["docs/console.md", "docs/connect.md", "docs/com10.md", "docs/a.b.md"]) {
      expect(specPathProblem(ok)).toBeNull();
    }
  });

  test("a card carries specPath and specState, empty for an older daemon", () => {
    const base = {
      id: "c",
      projectId: "p",
      title: "t",
      description: "",
      column: "backlog",
      columnLocked: false,
      position: 1,
      slug: null,
      branch: null,
      worktreePath: null,
      prUrl: null,
      prState: null,
      checksState: null,
      queued: false,
      sessionId: null,
      sessionStatus: null,
      notice: null,
      discarded: false,
      runs: [],
      createdAt: "2026-11-07T10:00:00Z",
      updatedAt: "2026-11-07T10:00:00Z",
    };
    const parsed = Card.parse(base);
    expect(parsed.specPath).toBeNull();
    expect(parsed.specState).toBeNull();
    const state = { path: "docs/specs/x.md", found: true, heading: "Spec" };
    expect(Card.parse({ ...base, specPath: "x.md", specState: state }).specState).toEqual(state);
  });

  test("card.update takes a specPath that passes the check, and null clears it; card.spec asks again", () => {
    const update = (specPath: unknown) =>
      Command.safeParse({ type: "card.update", id: "1", payload: { cardId: "c", specPath } })
        .success;
    expect(update("docs/specs/x.md")).toBe(true);
    expect(update(null)).toBe(true);
    expect(update("../x.md")).toBe(false);
    expect(update("/abs.md")).toBe(false);
    expect(
      Command.safeParse({ type: "card.spec", id: "1", payload: { cardId: "c" } }).success,
    ).toBe(true);
    expect(Command.safeParse({ type: "card.spec", id: "1", payload: {} }).success).toBe(false);
  });
});
