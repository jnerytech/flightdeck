import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { runGh } from "../src/github/gh.ts";
import { githubStatus, parseAuthStatus } from "../src/github/status.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function fakeGh(rules: FakeRule[]): FakeCli {
  const cli = installFakeCli("gh", rules);
  cleanups.push(cli.restore);
  return cli;
}

const LOGGED_IN = (source: string, scopes = "'gist', 'read:org', 'repo', 'read:project'") =>
  [
    "github.com",
    `  ✓ Logged in to github.com account octocat (${source})`,
    "  - Active account: true",
    "  - Git operations protocol: https",
    "  - Token: gho_************************************",
    `  - Token scopes: ${scopes}`,
    "",
  ].join("\n");

describe("github-status: whether the host's gh is signed in", () => {
  test("gh is not installed: nothing else is claimed", async () => {
    expect(await githubStatus(async () => null)).toEqual({
      installed: false,
      loggedIn: false,
      login: null,
      scopes: [],
      source: null,
    });
  });

  test("signed in through the keyring: the login, the scopes and the source", async () => {
    const gh = fakeGh([{ args: ["auth", "status"], stdout: LOGGED_IN("keyring") }]);
    expect(await githubStatus(runGh)).toEqual({
      installed: true,
      loggedIn: true,
      login: "octocat",
      scopes: ["gist", "read:org", "repo", "read:project"],
      source: "keyring",
    });
    expect(gh.calls()).toEqual([["auth", "status", "--hostname", "github.com"]]);
  });

  test("the text can come on stderr, as older gh versions print it", async () => {
    fakeGh([{ args: ["auth", "status"], stderr: LOGGED_IN("keyring") }]);
    expect(await githubStatus(runGh)).toMatchObject({ loggedIn: true, login: "octocat" });
  });

  test("the source is the keyring, the hosts file or the environment", () => {
    expect(parseAuthStatus(LOGGED_IN("keyring")).source).toBe("keyring");
    expect(parseAuthStatus(LOGGED_IN("/home/dev/.config/gh/hosts.yml")).source).toBe("file");
    expect(parseAuthStatus(LOGGED_IN("GH_TOKEN")).source).toBe("env");
    expect(parseAuthStatus(LOGGED_IN("GITHUB_TOKEN")).source).toBe("env");
  });

  test("signed out: gh exits with an error and says to log in", async () => {
    fakeGh([
      {
        args: ["auth", "status"],
        code: 1,
        stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login\n",
      },
    ]);
    expect(await githubStatus(runGh)).toEqual({
      installed: true,
      loggedIn: false,
      login: null,
      scopes: [],
      source: null,
    });
  });

  test("a missing repo scope is visible in the scopes", () => {
    expect(parseAuthStatus(LOGGED_IN("keyring", "'gist'")).scopes).toEqual(["gist"]);
    expect(parseAuthStatus(LOGGED_IN("keyring", "'gist'")).loggedIn).toBe(true);
  });

  test("a token is never part of the answer", async () => {
    fakeGh([
      {
        args: ["auth", "status"],
        stdout: `${LOGGED_IN("keyring")}  - Token: gho_REALSECRETVALUE0123456789\n`,
      },
    ]);
    expect(JSON.stringify(await githubStatus(runGh))).not.toContain("gho_");
  });
});
