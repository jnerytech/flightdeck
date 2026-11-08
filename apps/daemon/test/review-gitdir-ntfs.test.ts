import { describe, expect, test } from "bun:test";
import { FlightdeckError } from "../src/errors.ts";
import { fileInRoot, firstStep, isGitDir } from "../src/review/paths.ts";

/** Every way a filesystem may name the `.git` folder (issues #509, #1034). */
const SPELLINGS = [
  ".git",
  ".GIT",
  ".Git",
  ".git.",
  ".git ",
  ".git. .",
  // NTFS 8.3 short name of the folder, in any case, with a collision number.
  "GIT~1",
  "git~1",
  "Git~2",
  "GIT~12",
  "GIT~1 ",
  "GIT~1.",
  // NTFS streams on the folder: the default index stream, a named one, and with a dot or space.
  ".git::$INDEX_ALLOCATION",
  ".git:$I30:$INDEX_ALLOCATION",
  ".GIT::$index_allocation",
  ".git:anything",
  ".git. ::$INDEX_ALLOCATION",
  "GIT~1::$INDEX_ALLOCATION",
];

/** Names that only look like it: they are ordinary files and folders of a repository. */
const OTHERS = [
  ".gitignore",
  ".gitattributes",
  ".github",
  ".gitmodules",
  "git",
  "gitlab",
  "my.git",
  "git~",
  "git~x",
  "git~1x",
  "xgit~1",
  ".git~1",
  "src",
  "",
];

describe("isGitDir: the .git folder by any spelling a filesystem accepts (#509, #1034)", () => {
  test("each spelling of .git, its NTFS short name and its streams is the git folder", () => {
    const missed = SPELLINGS.filter((name) => !isGitDir(name));
    expect(missed).toEqual([]);
  });

  test("a name that only resembles it is not", () => {
    const refused = OTHERS.filter((name) => isGitDir(name));
    expect(refused).toEqual([]);
  });

  test("the first step of a path is read before the test, with either separator", () => {
    expect(isGitDir(firstStep("GIT~1/config"))).toBe(true);
    expect(isGitDir(firstStep("GIT~1\\config"))).toBe(true);
    expect(isGitDir(firstStep(".git::$INDEX_ALLOCATION/HEAD"))).toBe(true);
    expect(isGitDir(firstStep("src/GIT~1/config"))).toBe(false);
  });
});

describe("fileInRoot: a review path never reaches .git through its short name or a stream (#1034)", () => {
  const refused = (path: string) => {
    try {
      fileInRoot("/repo", path);
      return null;
    } catch (error) {
      return error instanceof FlightdeckError ? error.reason : "other";
    }
  };

  test("the short name and the stream forms are refused as outside the repository", () => {
    const paths = [
      "GIT~1/config",
      "git~1/HEAD",
      ".git::$INDEX_ALLOCATION/config",
      ".git:$I30:$INDEX_ALLOCATION/HEAD",
    ];
    expect(paths.map(refused)).toEqual(paths.map(() => "review_path_outside"));
  });

  test("an ordinary file with a similar name is let through", () => {
    expect(refused(".gitignore")).toBeNull();
    expect(refused("src/GIT~1/notes.md")).toBeNull();
  });
});
