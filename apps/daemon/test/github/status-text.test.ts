import { describe, expect, test } from "bun:test";
import { githubStatus, parseAuthStatus } from "../../src/github/domain/status.ts";

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

  test("the source is the keyring, the hosts file or the environment", () => {
    expect(parseAuthStatus(LOGGED_IN("keyring")).source).toBe("keyring");
    expect(parseAuthStatus(LOGGED_IN("/home/dev/.config/gh/hosts.yml")).source).toBe("file");
    expect(parseAuthStatus(LOGGED_IN("GH_TOKEN")).source).toBe("env");
    expect(parseAuthStatus(LOGGED_IN("GITHUB_TOKEN")).source).toBe("env");
  });

  test("a missing repo scope is visible in the scopes", () => {
    expect(parseAuthStatus(LOGGED_IN("keyring", "'gist'")).scopes).toEqual(["gist"]);
    expect(parseAuthStatus(LOGGED_IN("keyring", "'gist'")).loggedIn).toBe(true);
  });
});
