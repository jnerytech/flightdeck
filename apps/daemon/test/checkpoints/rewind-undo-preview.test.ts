import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCleanups, turnInRepo } from "../support/checkpoints-rewind.ts";

afterEach(runCleanups);

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { reason?: string }).reason ?? (error as Error).message;
  }
}

// #4041: what an undo would change, read from the newest safety snapshot and the working tree, writing nothing.
describe("rewind undoPreview (#4041)", () => {
  test("after a rewind and nothing since, it lists the files the rewind changed, which an undo puts back", async () => {
    const { rewinder, turn, repo } = await turnInRepo();
    await rewinder.apply("s1", turn, true);
    expect(await rewinder.undoPreview("s1")).toEqual({
      via: "snapshot",
      // From the saved state's point of view: README goes back to its edit, the file the turn deleted is
      // removed again (it is in the tree now), and the file the turn created is restored.
      files: [
        { path: "README.md", change: "modified" },
        { path: "apagar.txt", change: "created" },
        { path: "novo.txt", change: "deleted" },
      ],
      insertions: 2,
      deletions: 1,
    });
    // Reading changes nothing: the file the turn created is still gone.
    expect(existsSync(join(repo, "novo.txt"))).toBe(false);
  });

  test("a file edited after the rewind is listed too, since an undo would overwrite it", async () => {
    const { rewinder, turn, repo } = await turnInRepo();
    await rewinder.apply("s1", turn, true);
    writeFileSync(join(repo, "depois.txt"), "feito depois\n");
    const paths = (await rewinder.undoPreview("s1")).files.map((file) => file.path);
    expect(paths).toContain("depois.txt");
  });

  test("after the undo and nothing since, the files list is empty", async () => {
    const { rewinder, turn } = await turnInRepo();
    await rewinder.apply("s1", turn, true);
    await rewinder.undo("s1", true);
    expect((await rewinder.undoPreview("s1")).files).toEqual([]);
  });

  test("with no rewind in the session it says so, as the undo does", async () => {
    const { rewinder } = await turnInRepo();
    expect(await reasonOf(rewinder.undoPreview("s1"))).toBe("rewind_nothing");
  });
});
