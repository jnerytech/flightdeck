import { describe, expect, test } from "bun:test";
import { nameArgs, repoFolder } from "../../src/central/domain/claude-launch-args.ts";

/** The arguments a launch in `repo` adds, for a persona and the user's own arguments. */
const named = (
  repo: string,
  persona: string | null,
  user: string[] = [],
  over: { claude?: string; platform?: NodeJS.Platform } = {},
) => nameArgs({ repo, persona, user, claude: "claude", platform: "linux", ...over });

describe("session name: `<repo>-<persona>` for a launch of flightdeckd claude (#3432)", () => {
  test("a persona puts its id after the repo, joined by a hyphen", () => {
    // twice: no counter, no time in it
    expect([named("flightdeck", "architect"), named("flightdeck", "architect")]).toEqual([
      ["--name", "flightdeck-architect"],
      ["--name", "flightdeck-architect"],
    ]);
  });

  test("no persona: the repo alone", () => {
    expect(named("flightdeck", null)).toEqual(["--name", "flightdeck"]);
  });

  test("a name the person passed wins, in any of its three spellings", () => {
    for (const user of [["--name", "mine"], ["-n", "mine"], ["--name=mine"]]) {
      expect(named("flightdeck", "architect", user), user.join(" ")).toEqual([]);
    }
  });

  test("a session that is resumed or continued keeps the name it has", () => {
    for (const flag of ["--resume", "-r", "--continue", "-c", "--resume=abc"]) {
      expect(named("flightdeck", null, [flag]), flag).toEqual([]);
    }
  });

  test("a name text the terminal would act on has its control characters taken out", () => {
    expect(named("evil\u001b[2Jrepo\u202e", null)).toEqual(["--name", "evil[2Jrepo"]);
  });

  test("a repo name with nothing printable left adds no name", () => {
    expect(named("\u001b\u0007", null)).toEqual([]);
  });

  test("a Windows shim gets a name only when cmd.exe cannot read it as anything but text", () => {
    const shim = { claude: "C:\\npm\\claude.cmd", platform: "win32" as const };
    expect(named("my-repo.v2", "qa", [], shim)).toEqual(["--name", "my-repo.v2-qa"]);
    expect(named("a & calc", "qa", [], shim)).toEqual([]);
    expect(
      named("a & calc", "qa", [], { claude: "C:\\bin\\claude.exe", platform: "win32" }),
    ).toEqual(["--name", "a & calc-qa"]);
  });
});

describe("session name: the repo is the folder of the git toplevel (#3432)", () => {
  test("a launch folder inside a repo takes the toplevel's folder name", () => {
    expect(repoFolder("/work/flightdeck/apps/daemon", "/work/flightdeck")).toBe("flightdeck");
  });

  test("outside a repo, the launch folder's own name", () => {
    expect(repoFolder("/home/me/notes", null)).toBe("notes");
  });

  test("a trailing separator does not make the name empty", () => {
    expect(repoFolder("/home/me/notes/", null)).toBe("notes");
  });
});
