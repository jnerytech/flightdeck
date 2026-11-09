import { describe, expect, test } from "bun:test";
import type { CommandResult } from "../src/board/command.ts";
import {
  ConflictRadar,
  MAX_PEERS,
  MAX_SHARED_FILES,
  type RadarCard,
  radarGit,
} from "../src/board/conflict-radar.ts";
import { refArg } from "../src/board/ref-arg.ts";

/** A fake git: each worktree has a HEAD, the files its commits changed and the files it edits now. */
function fakeGit() {
  const trees = new Map<string, { head: string; committed: string[]; working: string[] }>();
  const calls: string[][] = [];
  const out = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: "" });
  const git = async (cwd: string, ...args: string[]): Promise<CommandResult> => {
    calls.push([cwd, ...args]);
    const tree = trees.get(cwd);
    if (!tree) return { code: 128, stdout: "", stderr: "not a repository" };
    if (args[0] === "rev-parse") return out(`${tree.head}\n`);
    if (args[0] === "diff" && args.some((arg) => arg.endsWith("...HEAD"))) {
      return out(tree.committed.map((file) => `${file}\0`).join(""));
    }
    if (args[0] === "diff") return out(tree.working.map((file) => `${file}\0`).join(""));
    return out("");
  };
  return { git, trees, calls };
}

const card = (id: string, extra: Partial<RadarCard> = {}): RadarCard => ({
  id,
  projectId: "p1",
  worktree: `/wt/${id}`,
  base: refArg("main"),
  group: id,
  ...extra,
});

function setup() {
  const fake = fakeGit();
  const radar = new ConflictRadar(fake.git);
  const edit = (id: string, committed: string[], working: string[] = [], head = `${id}-1`) =>
    fake.trees.set(`/wt/${id}`, { head, committed, working });
  return { ...fake, radar, edit };
}

describe("conflict-radar: who edits the same files", () => {
  test("two cards that share a file are both flagged, with the shared files", async () => {
    const { radar, edit } = setup();
    edit("a", ["src/a.ts", "src/shared.ts"]);
    edit("b", ["src/shared.ts", "src/b.ts"]);
    expect(await radar.update(card("a"))).toEqual(["a"]);
    expect((await radar.update(card("b"))).sort()).toEqual(["a", "b"]);
    expect(radar.overlaps("a")).toEqual([{ cardId: "b", files: ["src/shared.ts"] }]);
    expect(radar.overlaps("b")).toEqual([{ cardId: "a", files: ["src/shared.ts"] }]);
  });

  test("an uncommitted edit counts too, and a card that stops sharing is cleared with its peer", async () => {
    const { radar, edit } = setup();
    edit("a", [], ["src/x.ts"]);
    edit("b", ["src/y.ts"], ["src/x.ts"]);
    await radar.update(card("a"));
    await radar.update(card("b"));
    expect(radar.overlaps("a")).toEqual([{ cardId: "b", files: ["src/x.ts"] }]);
    edit("b", ["src/y.ts"], [], "b-2");
    expect((await radar.update(card("b"))).sort()).toEqual(["a", "b"]);
    expect([radar.overlaps("a"), radar.overlaps("b")]).toEqual([[], []]);
  });

  test("an unchanged HEAD does not ask for the commits again: the cache hit", async () => {
    const { radar, edit, calls } = setup();
    edit("a", ["src/a.ts"]);
    await radar.update(card("a"));
    const committed = () =>
      calls.filter((args) => args.some((arg) => arg.endsWith("...HEAD"))).length;
    expect(committed()).toBe(1);
    await radar.update(card("a"));
    expect(committed()).toBe(1);
    edit("a", ["src/a.ts", "src/more.ts"], [], "a-2");
    await radar.update(card("a"));
    expect(committed()).toBe(2);
  });

  test("cards of another project, or of the same group, are never flagged together", async () => {
    const { radar, edit } = setup();
    for (const id of ["a", "b", "c", "d"]) edit(id, ["src/shared.ts"]);
    await radar.update(card("a", { group: "arena" }));
    await radar.update(card("b", { group: "arena" }));
    await radar.update(card("c", { projectId: "p2" }));
    expect([radar.overlaps("a"), radar.overlaps("b"), radar.overlaps("c")]).toEqual([[], [], []]);
    // A card of the same project and another group is flagged with each of the variants.
    await radar.update(card("d"));
    expect(radar.overlaps("a")).toEqual([{ cardId: "d", files: ["src/shared.ts"] }]);
    expect(radar.overlaps("b")).toEqual([{ cardId: "d", files: ["src/shared.ts"] }]);
    expect(
      radar
        .overlaps("d")
        .map((overlap) => overlap.cardId)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  test("a card that leaves takes its flags with it, and the peers are told", async () => {
    const { radar, edit } = setup();
    edit("a", ["src/shared.ts"]);
    edit("b", ["src/shared.ts"]);
    await radar.update(card("a"));
    await radar.update(card("b"));
    expect(radar.remove("a")).toEqual(["b"]);
    expect([radar.overlaps("a"), radar.overlaps("b")]).toEqual([[], []]);
  });

  test("a worktree git cannot read leaves the card unflagged, quietly", async () => {
    const { radar, edit } = setup();
    expect(await radar.update(card("ghost"))).toEqual([]);
    expect(radar.overlaps("ghost")).toEqual([]);
    // The next card is read as usual.
    edit("a", ["src/a.ts"]);
    expect(await radar.update(card("a"))).toEqual(["a"]);
  });

  test("the list of shared files is capped", async () => {
    const { radar, edit } = setup();
    const files = Array.from({ length: MAX_SHARED_FILES + 5 }, (_, i) => `src/f${i}.ts`);
    edit("a", files);
    edit("b", files);
    await radar.update(card("a"));
    await radar.update(card("b"));
    expect(radar.overlaps("a")[0]?.files).toHaveLength(MAX_SHARED_FILES);
  });
});

describe("conflict-radar: failures and races", () => {
  test("a worktree git can no longer read drops the card's flags, and its peers hear of it", async () => {
    const { radar, edit, trees } = setup();
    edit("a", ["src/shared.ts"]);
    edit("b", ["src/shared.ts"]);
    await radar.update(card("a"));
    await radar.update(card("b"));
    trees.delete("/wt/b");
    expect((await radar.update(card("b"))).sort()).toEqual(["a", "b"]);
    expect([radar.overlaps("a"), radar.overlaps("b")]).toEqual([[], []]);
  });

  test("an update the card has moved on from leaves nothing behind", async () => {
    const { radar, edit } = setup();
    edit("a", ["src/shared.ts"]);
    edit("b", ["src/shared.ts"]);
    await radar.update(card("a"));
    expect(await radar.update(card("b"), () => false)).toEqual([]);
    expect(radar.overlaps("a")).toEqual([]);
  });

  test("a card lists at most MAX_PEERS others", async () => {
    const { radar, edit } = setup();
    for (let i = 0; i < MAX_PEERS + 4; i++) {
      edit(`p${i}`, ["src/shared.ts"]);
      await radar.update(card(`p${i}`));
    }
    expect(radar.overlaps("p0")).toHaveLength(MAX_PEERS);
  });
});

describe("conflict-radar: the git it runs", () => {
  test("every call turns the fsmonitor hook off, and a cut-off read is a failure", async () => {
    const seen: string[][] = [];
    const run = async (_cwd: string, _limit: number, args: string[]) => {
      seen.push(args);
      return { code: 0, stdout: "x", stderr: "", truncated: args.includes("--cached") };
    };
    const git = radarGit(1024, 5000, run);
    const diff = await git("/wt", "diff", "--name-only", "-z", "HEAD", "--");
    const files = await git("/wt", "diff", "--cached", "--name-only", "-z");
    expect(seen[0]?.slice(0, 4)).toEqual([
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.quotePath=false",
    ]);
    expect([diff.code, files.code]).toEqual([0, 1]);
  });
});

describe("conflict-radar: scale (#1191)", () => {
  test("200 cards: each update asks git a fixed number of times, and the lookup does not scan the others", async () => {
    const { radar, edit, calls } = setup();
    for (let i = 0; i < 200; i++) {
      // Each card owns a file and shares one with the next.
      edit(`c${i}`, [`own/${i}.ts`, `link/${i}.ts`, `link/${(i + 1) % 200}.ts`]);
    }
    for (let i = 0; i < 200; i++) await radar.update(card(`c${i}`));
    // rev-parse, the commits, the tracked edits and the untracked files.
    expect(calls.length).toBe(200 * 4);
    expect(
      radar
        .overlaps("c10")
        .map((overlap) => overlap.cardId)
        .sort(),
    ).toEqual(["c11", "c9"]);
    const before = calls.length;
    for (let i = 0; i < 200; i++) await radar.update(card(`c${i}`));
    // The commits are cached: three calls each on an unchanged HEAD.
    expect(calls.length - before).toBe(200 * 3);
  });
});
