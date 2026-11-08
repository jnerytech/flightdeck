import { describe, expect, test } from "bun:test";
import {
  closeSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { descriptorInside, readSpec, stillThere } from "../src/board/spec.ts";
import { FlightdeckError } from "../src/errors.ts";
import { newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

const posix = process.platform !== "win32";

/** A worktree folder with an `outside` folder next to it, which a spec must never reach. */
function folders() {
  const base = realpathSync.native(tempDir("fd-spec-"));
  const root = join(base, "tree");
  const outside = join(base, "outside");
  mkdirSync(root, { recursive: true });
  mkdirSync(outside);
  return { base, root, outside };
}

describe("card-spec: what the daemon learns of a spec file", () => {
  test("a file of the worktree is found, with its first heading and nothing else", async () => {
    const { root } = folders();
    mkdirSync(join(root, "docs/specs"), { recursive: true });
    writeFileSync(
      join(root, "docs/specs/login.md"),
      "Some words first\n\n# The login spec\n\nSECRET BODY TEXT\n## Later heading\n",
    );
    const found = await readSpec(root, "docs/specs/login.md");
    expect(found).toEqual({ found: true, heading: "The login spec" });
    // Only those two fields leave: the contents never do.
    expect(Object.keys(found).sort()).toEqual(["found", "heading"]);
    expect(JSON.stringify(found)).not.toContain("SECRET");
  });

  test("a file with no heading is found, and an empty or missing one is not", async () => {
    const { root } = folders();
    writeFileSync(join(root, "plain.md"), "no heading here\n");
    writeFileSync(join(root, "empty.md"), "");
    expect(await readSpec(root, "plain.md")).toEqual({ found: true, heading: null });
    expect(await readSpec(root, "empty.md")).toEqual({ found: false, heading: null });
    expect(await readSpec(root, "missing.md")).toEqual({ found: false, heading: null });
    expect(await readSpec(join(root, "nope"), "plain.md")).toEqual({ found: false, heading: null });
  });

  test("a folder named like a spec, or an odd file, is not one", async () => {
    const { root } = folders();
    mkdirSync(join(root, "dir.md"));
    expect(await readSpec(root, "dir.md")).toEqual({ found: false, heading: null });
    if (!posix) return;
    const made = Bun.spawnSync(["mkfifo", join(root, "pipe.md")]);
    if (made.exitCode === 0) {
      // A pipe is never opened: it would block the daemon waiting for a writer.
      expect(await readSpec(root, "pipe.md")).toEqual({ found: false, heading: null });
    }
  });

  test("the heading is the first ATX heading, trimmed, closed hashes dropped, controls removed, capped", async () => {
    const { root } = folders();
    writeFileSync(join(root, "a.md"), "   ##   Spaced out  ##  \n# Second\n");
    expect((await readSpec(root, "a.md")).heading).toBe("Spaced out");
    writeFileSync(join(root, "b.md"), "# Tab\there\u0007bell\u001b[31m red\n");
    // A tab separates words, so it becomes a space; the other controls just go.
    expect((await readSpec(root, "b.md")).heading).toBe("Tab herebell[31m red");
    writeFileSync(join(root, "c.md"), `# ${"x".repeat(500)}\n`);
    expect((await readSpec(root, "c.md")).heading).toBe("x".repeat(120));
    writeFileSync(join(root, "d.md"), "#nospace\n####### seven\nsetext\n=====\n");
    expect((await readSpec(root, "d.md")).heading).toBeNull();
    writeFileSync(join(root, "e.md"), "# Windows\r\nbody\r\n");
    expect((await readSpec(root, "e.md")).heading).toBe("Windows");
  });

  test("only the start of a big file is looked at", async () => {
    const { root } = folders();
    writeFileSync(join(root, "big.md"), `${"filler line\n".repeat(2000)}# Too late\n`);
    expect(await readSpec(root, "big.md")).toEqual({ found: true, heading: null });
  });

  test("a path that leaves the worktree names nothing, even where the file exists", async () => {
    const { root, outside } = folders();
    writeFileSync(join(outside, "secret.md"), "# Not yours\n");
    for (const path of [
      "../outside/secret.md",
      "a/../../outside/secret.md",
      join(outside, "secret.md"),
      "..\\outside\\secret.md",
      "outside/secret.txt",
    ]) {
      expect(await readSpec(root, path)).toEqual({ found: false, heading: null });
    }
  });

  test("a symlink never carries a read out of the worktree, or into another file of it", async () => {
    if (!posix) return;
    const { root, outside } = folders();
    writeFileSync(join(outside, "secret.md"), "# Not yours\n");
    writeFileSync(join(root, "real.md"), "# Real\n");
    // A link to a file outside, a link to a file inside, and a folder that is a link outside.
    symlinkSync(join(outside, "secret.md"), join(root, "out-link.md"));
    symlinkSync(join(root, "real.md"), join(root, "in-link.md"));
    symlinkSync(outside, join(root, "docs"));
    expect(await readSpec(root, "out-link.md")).toEqual({ found: false, heading: null });
    expect(await readSpec(root, "in-link.md")).toEqual({ found: false, heading: null });
    expect(await readSpec(root, "docs/secret.md")).toEqual({ found: false, heading: null });
    // A broken or looping link is only missing.
    symlinkSync(join(root, "gone.md"), join(root, "broken.md"));
    symlinkSync(join(root, "loop.md"), join(root, "loop.md"));
    expect(await readSpec(root, "broken.md")).toEqual({ found: false, heading: null });
    expect(await readSpec(root, "loop.md")).toEqual({ found: false, heading: null });
  });

  test("a folder swapped for a link between the check and the open is not followed", async () => {
    if (!posix) return;
    const { root, outside } = folders();
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs/s.md"), "# Inside\n");
    writeFileSync(join(outside, "s.md"), "# Outside\n");
    const swapped = await readSpec(root, "docs/s.md", {
      beforeOpen: async () => {
        renameSync(join(root, "docs"), join(root, "docs-away"));
        symlinkSync(outside, join(root, "docs"));
      },
    });
    expect(swapped).toEqual({ found: false, heading: null });
  });

  test("the same file swapped for another one in that gap is not read either", async () => {
    const { root } = folders();
    writeFileSync(join(root, "s.md"), "# First\n");
    const swapped = await readSpec(root, "s.md", {
      beforeOpen: async () => {
        // The other file exists before the first goes, so the two cannot share an inode.
        writeFileSync(join(root, "next.md"), "# Second\n");
        renameSync(join(root, "next.md"), join(root, "s.md"));
      },
    });
    expect(swapped).toEqual({ found: false, heading: null });
  });

  test("a second name for a file outside the worktree (a hard link) is refused", async () => {
    if (!posix) return;
    const { root, outside } = folders();
    writeFileSync(join(outside, "secret.md"), "# Not yours\n");
    linkSync(join(outside, "secret.md"), join(root, "hard.md"));
    expect(await readSpec(root, "hard.md")).toEqual({ found: false, heading: null });
  });

  test("a heading carries no invisible or direction-changing character", async () => {
    const { root } = folders();
    writeFileSync(join(root, "h.md"), "# A\u0085B\u202eC\u200bD\u2028E\u2066F\u00adG\ufeffH\n");
    expect((await readSpec(root, "h.md")).heading).toBe("ABCDEFGH");
  });

  test("a heading line made to make a pattern backtrack is read in linear time", async () => {
    const { root } = folders();
    writeFileSync(join(root, "slow.md"), `# a${" ".repeat(8000)}b\n`);
    const started = performance.now();
    const found = await readSpec(root, "slow.md");
    expect(performance.now() - started).toBeLessThan(80);
    expect(found.heading).toBe(`a${" ".repeat(8000)}b`.slice(0, 120));
  });

  test("where the system says where a descriptor points, one that points elsewhere, or cannot be asked, is not inside", async () => {
    if (process.platform !== "linux") return;
    const { root, outside } = folders();
    writeFileSync(join(root, "in.md"), "# In\n");
    writeFileSync(join(outside, "out.md"), "# Out\n");
    const inside = openSync(join(root, "in.md"), "r");
    const elsewhere = openSync(join(outside, "out.md"), "r");
    try {
      expect(await descriptorInside(root, inside)).toBe(true);
      expect(await descriptorInside(root, elsewhere)).toBe(false);
      // A descriptor that does not exist cannot be told apart from one that hides: refused.
      expect(await descriptorInside(root, 999_999)).toBe(false);
      // A system with no such folder does not tell where a descriptor points: it is not asked.
      expect(await descriptorInside(root, elsewhere, join(root, "no-proc-here"))).toBe(true);
    } finally {
      closeSync(inside);
      closeSync(elsewhere);
    }
  });

  test("a path that went away after the open, or leads to another file, is not the file that was opened", async () => {
    const { root } = folders();
    writeFileSync(join(root, "here.md"), "# Here\n");
    const info = lstatSync(join(root, "here.md"), { bigint: true });
    expect(await stillThere(root, join(root, "here.md"), info)).toBe(true);
    expect(await stillThere(root, join(root, "gone.md"), info)).toBe(false);
    expect(
      await stillThere(root, join(root, "here.md"), { dev: info.dev, ino: info.ino + 1n }),
    ).toBe(false);
  });

  test("a worktree reached through a link is still the worktree", async () => {
    if (!posix) return;
    const { base, root } = folders();
    writeFileSync(join(root, "ok.md"), "# Fine\n");
    const alias = join(base, "alias");
    symlinkSync(root, alias);
    expect(await readSpec(alias, "ok.md")).toEqual({ found: true, heading: "Fine" });
  });

  test("a path with a null byte or an odd shape is refused before any file is touched", async () => {
    const { root } = folders();
    writeFileSync(join(root, "x.md"), "# X\n");
    for (const path of ["x\u0000.md", "", ".", "./x.md", "docs//x.md", "x.md/"]) {
      expect(await readSpec(root, path)).toEqual({ found: false, heading: null });
    }
    expect(await readSpec("", "x.md")).toEqual({ found: false, heading: null });
  });
});

async function withCard() {
  const ctx = newBoard();
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, { title: "Login screen", description: "d" });
  const { root } = folders();
  ctx.store.db
    .query("UPDATE cards SET worktree_path = ?, slug = ? WHERE id = ?")
    .run(root, "login-screen", card.id);
  return { ...ctx, project, card, tree: root };
}

const never = async (call: () => unknown): Promise<FlightdeckError> => {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(FlightdeckError);
    return error as FlightdeckError;
  }
  throw new Error("it did not refuse");
};

describe("card-spec: the card keeps what it found", () => {
  test("the default spec is docs/specs/<slug>.md in the card's worktree", async () => {
    const { board, card, tree } = await withCard();
    // Where it looked is kept even when nothing is there: the card says where a spec is expected.
    expect((await board.refreshSpec(card.id)).specState).toEqual({
      path: "docs/specs/login-screen.md",
      found: false,
      heading: null,
    });
    mkdirSync(join(tree, "docs/specs"), { recursive: true });
    writeFileSync(join(tree, "docs/specs/login-screen.md"), "# Login\n");
    const found = await board.refreshSpec(card.id);
    expect(found.specState).toEqual({
      path: "docs/specs/login-screen.md",
      found: true,
      heading: "Login",
    });
    expect(board.getCard(card.id).specState).toEqual(found.specState);
  });

  test("a path set on the card wins over the default, and null goes back to it", async () => {
    const { board, card, tree } = await withCard();
    writeFileSync(join(tree, "mine.md"), "# Mine\n");
    expect(board.updateCard(card.id, { specPath: "mine.md" }).specPath).toBe("mine.md");
    expect((await board.refreshSpec(card.id)).specState).toEqual({
      path: "mine.md",
      found: true,
      heading: "Mine",
    });
    expect(board.updateCard(card.id, { specPath: null }).specPath).toBeNull();
    expect((await board.refreshSpec(card.id)).specState?.path).toBe("docs/specs/login-screen.md");
  });

  test("a card with no worktree has no spec to look at", async () => {
    const ctx = newBoard();
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "t", description: "d" });
    expect((await ctx.board.refreshSpec(card.id)).specState).toBeNull();
  });

  test("a bad specPath is refused with a reason, and the card keeps its own", async () => {
    const { board, card } = await withCard();
    for (const bad of ["../x.md", "/etc/x.md", "x.txt", "a/../../b.md"]) {
      const error = await never(() => board.updateCard(card.id, { specPath: bad }));
      expect(error.code).toBe("bad_request");
      expect(error.reason).toBe("spec_path_invalid");
    }
    expect(board.getCard(card.id).specPath).toBeNull();
  });

  test("a look that ends after the card named another path does not overwrite what was found for it", async () => {
    const { board, card, tree } = await withCard();
    writeFileSync(join(tree, "one.md"), "# One\n");
    writeFileSync(join(tree, "two.md"), "# Two\n");
    board.updateCard(card.id, { specPath: "one.md" });
    const first = board.refreshSpec(card.id);
    // The card names another path while the first look is still reading.
    board.updateCard(card.id, { specPath: "two.md" });
    await first;
    expect(board.getCard(card.id).specState).toBeNull();
    expect((await board.refreshSpec(card.id)).specState).toEqual({
      path: "two.md",
      found: true,
      heading: "Two",
    });
  });

  test("a look that ends after the card got another worktree does not write what it found", async () => {
    const { board, card, tree, store } = await withCard();
    mkdirSync(join(tree, "docs/specs"), { recursive: true });
    writeFileSync(join(tree, "docs/specs/login-screen.md"), "# Login\n");
    const first = board.refreshSpec(card.id);
    store.db.query("UPDATE cards SET worktree_path = ? WHERE id = ?").run(folders().root, card.id);
    await first;
    expect(board.getCard(card.id).specState).toBeNull();
  });

  test("a card whose stored spec path no longer passes the rules can still be edited", async () => {
    const { board, card, store } = await withCard();
    store.db.query("UPDATE cards SET spec_path = ? WHERE id = ?").run("old/a:b.md", card.id);
    expect(board.updateCard(card.id, { title: "renamed" }).title).toBe("renamed");
    // Only a path in the patch is judged.
    const error = await never(() => board.updateCard(card.id, { specPath: "x/a:b.md" }));
    expect(error.reason).toBe("spec_path_invalid");
    expect(board.updateCard(card.id, { specPath: null }).specPath).toBeNull();
  });

  // #996: only timing reached this line before; a run where it did not missed the 100% gate.
  test("a look that ends after the board stopped writes nothing, and one after the card went away gives it back", async () => {
    const stopped = await withCard();
    // A spec is there, so a look that missed the stop would write spec_found = 1 (#1000 review).
    mkdirSync(join(stopped.tree, "docs/specs"), { recursive: true });
    writeFileSync(join(stopped.tree, "docs/specs/login-screen.md"), "# Login\n");
    const look = stopped.board.refreshSpec(stopped.card.id);
    stopped.board.stop();
    expect((await look).specState).toBeNull();
    expect(stopped.store.db.query("SELECT spec_found FROM cards").get()).toEqual({ spec_found: 0 });
    const gone = await withCard();
    const later = gone.board.refreshSpec(gone.card.id);
    // A discard that ended while the file was read: the row is gone.
    gone.store.db.query("DELETE FROM cards WHERE id = ?").run(gone.card.id);
    expect((await later).id).toBe(gone.card.id);
    expect(gone.store.db.query("SELECT 1 FROM cards WHERE id = ?").get(gone.card.id)).toBeNull();
  });

  test("a spec that went away is lost again", async () => {
    const { board, card, tree } = await withCard();
    writeFileSync(join(tree, "mine.md"), "# Mine\n");
    board.updateCard(card.id, { specPath: "mine.md" });
    expect((await board.refreshSpec(card.id)).specState?.found).toBe(true);
    rmSync(join(tree, "mine.md"));
    expect((await board.refreshSpec(card.id)).specState).toEqual({
      path: "mine.md",
      found: false,
      heading: null,
    });
  });
});

describe("card-spec: a column that asks for a spec", () => {
  async function asking() {
    const ctx = await withCard();
    ctx.board.updateProject(ctx.project.id, {
      contractByColumn: { review: { enforce: "confirm", checks: ["spec"] } },
    });
    return ctx;
  }

  test("a person's move looks at the file first: refused with no spec, let in once it is there", async () => {
    const { board, card, tree } = await asking();
    const error = await never(() => board.moveByHand(card.id, "review", undefined, false));
    expect(error.reason).toBe("card_contract_unmet");
    expect(error.params).toEqual({ column: "review", needs: "spec" });
    // The file appeared after the card was last looked at: the move sees it, no refresh asked.
    mkdirSync(join(tree, "docs/specs"), { recursive: true });
    writeFileSync(join(tree, "docs/specs/login-screen.md"), "# Login\n");
    expect((await board.moveByHand(card.id, "review", undefined, false)).column).toBe("review");
  });

  test("a spec that went away is caught by the move too, and forcing records it", async () => {
    const { board, card, tree } = await asking();
    mkdirSync(join(tree, "docs/specs"), { recursive: true });
    writeFileSync(join(tree, "docs/specs/login-screen.md"), "# Login\n");
    await board.refreshSpec(card.id);
    rmSync(join(tree, "docs/specs/login-screen.md"));
    const moved = await board.moveByHand(card.id, "review", undefined, true);
    expect(moved.column).toBe("review");
    expect(moved.noticeParams).toEqual({ column: "review", needs: "spec" });
  });

  test("what moves cards on its own never looks at a spec, and no other column pays for it", async () => {
    const { board, card } = await asking();
    expect(board.moveCard(card.id, "review").column).toBe("review");
    // A move to a column that does not ask for a spec does not read a file.
    const plain = await withCard();
    expect((await plain.board.moveByHand(plain.card.id, "waiting", undefined, false)).column).toBe(
      "waiting",
    );
    expect(plain.board.getCard(plain.card.id).specState).toBeNull();
  });
});
