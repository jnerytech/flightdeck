import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";

const refusedWith = (argv: string[]): string => {
  try {
    parseArgs(argv);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};

describe("flightdeckd session teleport: the words and flags (issue #3704)", () => {
  test("it reads the session, --to, --repo, --confirm, --host and --json, and --to is not the history range", () => {
    const args = parseArgs([
      "session",
      "teleport",
      "api",
      "--to",
      "pi",
      "--repo",
      "/srv/api",
      "--confirm",
      "--json",
      "--host",
      "server",
    ]);
    expect(args).toMatchObject({
      command: "session",
      action: "teleport",
      sessionRef: "api",
      teleport: { to: "pi", repo: "/srv/api" },
      confirm: true,
      json: true,
      host: "server",
    });
    expect(args.until).toBeUndefined();
  });

  test("a missing session, --to or --repo is refused", () => {
    expect(refusedWith(["session", "teleport"])).toContain("the session");
    expect(refusedWith(["session", "teleport", "api", "--repo", "/srv/api"])).toContain(
      "missing --to",
    );
    expect(refusedWith(["session", "teleport", "api", "--to", "pi"])).toContain("missing --repo");
  });

  test("the session cannot move to the host it is on", () => {
    expect(
      refusedWith(["session", "teleport", "api", "--to", "pi", "--repo", "/r", "--host", "pi"]),
    ).toContain("the session cannot move to the host it is on");
  });

  test("--to, --repo and --confirm belong to session teleport only", () => {
    expect(refusedWith(["session", "close", "api", "--to", "pi"])).toContain(
      "--to: this flag only applies to flightdeckd session teleport",
    );
    expect(refusedWith(["session", "close", "api", "--repo", "/srv/api"])).toContain(
      "--repo: this flag only applies to flightdeckd session teleport",
    );
    expect(refusedWith(["session", "close", "api", "--confirm"])).toContain(
      "--confirm: this flag only applies to flightdeckd session teleport",
    );
    expect(refusedWith(["sessions", "--repo", "/srv/api"])).toContain("--repo");
  });
});
