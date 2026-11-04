import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { GITHUB_SCOPES, GithubLogin } from "../src/github/login.ts";
import { poll } from "./helpers.ts";

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

function login(options: ConstructorParameters<typeof GithubLogin>[0] = {}) {
  const logins = new GithubLogin(options);
  cleanups.push(() => logins.cancel());
  return logins;
}

const CODE_TEXT =
  "! First copy your one-time code: ABCD-1234\nOpen this URL to continue in your web browser: https://github.com/login/device\n";
const WAITING: FakeRule = { args: ["auth", "login"], stderr: CODE_TEXT, delayMs: 30_000 };

describe("github-login: the device flow through gh", () => {
  test("the scopes are the narrowest ones: repo and read:project", () => {
    expect(GITHUB_SCOPES).toEqual(["repo", "read:project"]);
  });

  test("start answers with the one-time code and the page gh printed, and runs gh with fixed arguments", async () => {
    const gh = fakeGh([WAITING]);
    const logins = login();
    expect(await logins.start()).toEqual({
      code: "ABCD-1234",
      url: "https://github.com/login/device",
    });
    expect(logins.running).toBe(true);
    expect(gh.calls()).toEqual([
      [
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--git-protocol",
        "https",
        "--scopes",
        "repo,read:project",
        "--web",
      ],
    ]);
  });

  test("one login at a time: a second start gives the running one's code and starts no second gh", async () => {
    const gh = fakeGh([WAITING]);
    const logins = login();
    const first = await logins.start();
    expect(await logins.start()).toEqual(first);
    expect(gh.calls()).toHaveLength(1);
  });

  test("cancel stops gh, and the next start asks for a new code", async () => {
    const gh = fakeGh([WAITING]);
    const logins = login();
    await logins.start();
    logins.cancel();
    expect(await poll(() => !logins.running, 4000)).toBe(true);
    await logins.start();
    expect(gh.calls()).toHaveLength(2);
  });

  test("cancel ends the run even when a child of gh keeps the pipes open, and the kill reaches the tree", async () => {
    // A Windows .cmd shim: ending it leaves the bun it started holding stdout and stderr.
    fakeGh([{ ...WAITING, holdPipesMs: 30_000 }]);
    const killed: number[] = [];
    const logins = login({
      kill: async (pid) => {
        killed.push(pid);
        process.kill(pid);
      },
    });
    await logins.start();
    logins.cancel();
    expect(await poll(() => !logins.running, 4000)).toBe(true);
    expect(killed).toHaveLength(1);
  });

  test("a login that finishes ends the run", async () => {
    fakeGh([{ args: ["auth", "login"], stderr: CODE_TEXT, delayMs: 200 }]);
    const logins = login();
    await logins.start();
    expect(await poll(() => !logins.running, 4000)).toBe(true);
  });

  test("no code in time: gh is stopped and the refusal says so", async () => {
    fakeGh([{ args: ["auth", "login"], delayMs: 30_000 }]);
    const logins = login({ codeTimeoutMs: 300 });
    await expect(logins.start()).rejects.toMatchObject({ reason: "login_timeout" });
    expect(await poll(() => !logins.running, 4000)).toBe(true);
  });

  test("the person never finishes: the login ends by itself after its time", async () => {
    fakeGh([WAITING]);
    const logins = login({ loginTimeoutMs: 300 });
    await logins.start();
    expect(await poll(() => !logins.running, 4000)).toBe(true);
  });

  test("gh fails before it prints a code: login_failed with what gh said", async () => {
    fakeGh([{ args: ["auth", "login"], code: 1, stderr: "error connecting to github.com\n" }]);
    await expect(login().start()).rejects.toMatchObject({
      reason: "login_failed",
      params: { detail: "error connecting to github.com" },
    });
  });

  test("gh is not installed: gh_missing", async () => {
    await expect(login({ find: () => null }).start()).rejects.toMatchObject({
      reason: "gh_missing",
    });
  });

  test("the code stays out of the log", async () => {
    fakeGh([WAITING]);
    const lines: string[] = [];
    const logins = login({ log: (message) => lines.push(message) });
    await logins.start();
    expect(lines.join("\n")).not.toContain("ABCD-1234");
  });
});
