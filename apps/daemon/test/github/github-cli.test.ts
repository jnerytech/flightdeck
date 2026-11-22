import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Issue } from "@flightdeck/protocol";
import { parseArgs } from "../../src/main.ts";
import { fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const STATUS = {
  installed: true,
  loggedIn: true,
  login: "octocat",
  scopes: ["repo", "read:org"],
  source: "keyring",
};
const REPOS = [
  {
    name: "octocat/hello",
    description: "My first repo",
    private: false,
    url: "https://github.com/octocat/hello",
    updatedAt: "2026-11-20T10:00:00Z",
  },
  {
    name: "octocat/secret-plans",
    description: "",
    private: true,
    url: "https://github.com/octocat/secret-plans",
    updatedAt: "2026-11-19T08:30:00Z",
  },
];
const ISSUE: Issue = {
  ref: "github:octocat/hello#7",
  id: "7",
  title: "Crash on start",
  body: "It crashes.",
  url: "https://github.com/octocat/hello/issues/7",
  author: "stranger",
  labels: ["bug"],
  external: true,
  createdAt: "2026-11-18T12:00:00Z",
};

const OPEN: Handlers = {
  "github.status": () => STATUS,
  "github.repos": () => ({ repos: REPOS }),
  "github.issues": () => ({
    issues: [
      ISSUE,
      {
        ...ISSUE,
        ref: "github:octocat/hello#8",
        id: "8",
        title: "Docs",
        external: false,
        labels: [],
      },
    ],
  }),
};

/** The JSON a command printed; an empty output is `{}`, so a missing print fails by assertion. */
const asJson = (out: string[]) => JSON.parse(out.join("\n") || "{}");

const sent = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const parsed = (argv: string[]): Record<string, unknown> => {
  try {
    return { ...parseArgs(argv) };
  } catch (error) {
    return { refusal: String((error as Error).message).split("\n")[0] };
  }
};

describe("the github arguments (issue #3703)", () => {
  test("status, repos and issues are read, with the host and --json flags", () => {
    expect(parsed(["github", "status", "--json", "--host", "pi"])).toMatchObject({
      command: "github",
      action: "status",
      json: true,
      host: "pi",
    });
    expect(parsed(["github", "repos", "--query", "hello"])).toMatchObject({
      command: "github",
      action: "repos",
      query: "hello",
    });
    expect(parsed(["github", "issues", "octocat/hello"])).toMatchObject({
      command: "github",
      action: "issues",
      githubWords: ["octocat/hello"],
    });
  });

  test("a missing verb, a missing repo and a flag of another verb are refused before any connection", () => {
    for (const line of [
      ["github"],
      ["github", "nope"],
      ["github", "issues"],
      ["github", "issues", "a", "b"],
      ["github", "status", "extra"],
      ["github", "repos", "extra"],
    ]) {
      expect(parsed(line)).toHaveProperty("refusal");
    }
    expect(parsed(["github", "status", "--query", "x"])).toHaveProperty(
      "refusal",
      expect.stringContaining("--query"),
    );
    expect(parsed(["github", "issues", "octocat/hello", "--query", "x"])).toHaveProperty(
      "refusal",
      expect.stringContaining("--query"),
    );
    expect(parsed(["github", "repos", "--query", "a\nb"])).toHaveProperty(
      "refusal",
      expect.stringContaining("--query"),
    );
    expect(parsed(["github", "repos", "--query", "  "])).toHaveProperty(
      "refusal",
      expect.stringContaining("--query"),
    );
  });
});

describe("flightdeckd github status (issue #3703)", () => {
  test("it says who is signed in, where the login lives and the scopes, and never a token", async () => {
    const daemon = fakeDaemon({ "github.status": () => ({ ...STATUS, token: "ghp_secret" }) });
    const run = await flightdeckd(["github", "status"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["signed in as octocat (keyring)", "scopes: repo, read:org"]);
    expect(run.out.join("\n")).not.toContain("ghp_secret");
  });

  test("--json prints the five keys and nothing else, null for what is missing", async () => {
    const daemon = fakeDaemon({
      "github.status": () => ({
        installed: true,
        loggedIn: false,
        login: null,
        scopes: [],
        source: null,
        token: "ghp_secret",
      }),
    });
    const run = await flightdeckd(["github", "status", "--json"], daemon.port);
    expect(asJson(run.out)).toEqual({
      installed: true,
      loggedIn: false,
      login: null,
      scopes: [],
      source: null,
    });
  });

  test("a host without gh, and one with gh signed out, say so and still exit 0", async () => {
    const missing = fakeDaemon({
      "github.status": () => ({
        installed: false,
        loggedIn: false,
        login: null,
        scopes: [],
        source: null,
      }),
    });
    const none = await flightdeckd(["github", "status"], missing.port);
    expect([none.code, none.out]).toEqual([0, ["gh is not installed on this host"]]);
    const out = fakeDaemon({
      "github.status": () => ({
        installed: true,
        loggedIn: false,
        login: null,
        scopes: [],
        source: null,
      }),
    });
    const signedOut = await flightdeckd(["github", "status"], out.port);
    expect([signedOut.code, signedOut.out]).toEqual([0, ["gh is not signed in on this host"]]);
  });

  test("a login that comes from the environment is told as such", async () => {
    const daemon = fakeDaemon({
      "github.status": () => ({ ...STATUS, source: "env", scopes: [] }),
    });
    const run = await flightdeckd(["github", "status"], daemon.port);
    expect(run.out[0]).toBe("signed in as octocat (environment token)");
  });

  test("a login source a newer host adds is printed as it came, not as undefined", async () => {
    const daemon = fakeDaemon({ "github.status": () => ({ ...STATUS, source: "vault" }) });
    const run = await flightdeckd(["github", "status"], daemon.port);
    expect(run.out[0]).toBe("signed in as octocat (vault)");
  });

  test("no daemon is exit 2", async () => {
    const daemon = fakeDaemon(OPEN);
    const { port } = daemon;
    await stopAll();
    expect((await flightdeckd(["github", "status"], port)).code).toBe(2);
  });
});

describe("flightdeckd github repos and issues (issue #3703)", () => {
  test("repos prints one line per repository and sends the query", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["github", "repos", "--query", "hello"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "octocat/hello  public  2026-11-20T10:00:00Z  My first repo",
      "octocat/secret-plans  private  2026-11-19T08:30:00Z",
    ]);
    expect(sent(daemon, "github.repos")).toEqual([{ query: "hello" }]);
  });

  test("repos with no query sends none, an empty list says so, and --json prints the list", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(["github", "repos"], daemon.port);
    expect(sent(daemon, "github.repos")).toEqual([{}]);
    const json = await flightdeckd(["github", "repos", "--json"], daemon.port);
    expect(asJson(json.out)).toEqual({ repos: REPOS });
    const none = fakeDaemon({ "github.repos": () => ({ repos: [] }) });
    expect((await flightdeckd(["github", "repos"], none.port)).out).toEqual(["no repositories"]);
  });

  test("issues prints one line each and marks the ones written by someone outside the team", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["github", "issues", "octocat/hello"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "github:octocat/hello#7  EXTERNAL: written by someone outside the team  Crash on start  [bug]  by stranger",
      "github:octocat/hello#8  Docs  by stranger",
    ]);
    expect(sent(daemon, "github.issues")).toEqual([{ repo: "octocat/hello" }]);
  });

  test("issues cleans terminal control sequences out of the title, and --json keeps the issues as sent", async () => {
    const daemon = fakeDaemon({
      "github.issues": () => ({ issues: [{ ...ISSUE, title: "Hi\u001b[2Jthere" }] }),
    });
    const run = await flightdeckd(["github", "issues", "octocat/hello"], daemon.port);
    expect(run.out.join("\n")).not.toContain("\u001b");
    const json = await flightdeckd(["github", "issues", "octocat/hello", "--json"], daemon.port);
    expect(asJson(json.out).issues?.[0]?.external).toBe(true);
  });

  test("a repository the daemon refuses is exit 1 with its text", async () => {
    const daemon = fakeDaemon({
      "github.issues": () => ({ error: { code: "invalid", message: "give owner/name" } }),
    });
    const run = await flightdeckd(["github", "issues", "nonsense"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("give owner/name")]);
  });
});
