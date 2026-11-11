import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { runGh } from "../src/github/gh.ts";
import { Github } from "../src/github/github.ts";

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

const status = (source: string): FakeRule => ({
  args: ["auth", "status"],
  stdout: `github.com\n  ✓ Logged in to github.com account octocat (${source})\n  - Token scopes: 'repo'\n`,
});

describe("github-logout: signing out of the host's gh", () => {
  test("a login in the keyring is signed out through gh", async () => {
    const gh = fakeGh([status("keyring"), { args: ["auth", "logout"] }]);
    await new Github({ gh: runGh }).logout();
    expect(gh.calls()).toEqual([
      ["auth", "status", "--hostname", "github.com"],
      ["auth", "logout", "--hostname", "github.com"],
    ]);
  });

  test("a login that comes from the environment is refused, and gh is not asked to sign out", async () => {
    const gh = fakeGh([status("GH_TOKEN"), { args: ["auth", "logout"] }]);
    await expect(new Github({ gh: runGh }).logout()).rejects.toMatchObject({
      reason: "login_from_env",
    });
    expect(gh.calls().some((call) => call.includes("logout"))).toBe(false);
  });

  test("signed out already: nothing to do, and a reason the app can show", async () => {
    fakeGh([
      { args: ["auth", "status"], code: 1, stderr: "You are not logged into any GitHub hosts.\n" },
    ]);
    await expect(new Github({ gh: runGh }).logout()).rejects.toMatchObject({
      reason: "gh_logged_out",
    });
  });

  test("gh is not installed: gh_missing", async () => {
    await expect(new Github({ gh: async () => null }).logout()).rejects.toMatchObject({
      reason: "gh_missing",
    });
  });

  test("gh fails to sign out: logout_failed with what it said", async () => {
    fakeGh([
      status("keyring"),
      { args: ["auth", "logout"], code: 1, stderr: "keyring is locked\n" },
    ]);
    await expect(new Github({ gh: runGh }).logout()).rejects.toMatchObject({
      reason: "logout_failed",
      params: { detail: "keyring is locked" },
    });
  });
});
