import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const DEVICE = { code: "ABCD-1234", url: "https://github.com/login/device" };
const STARTED = { projectId: "p1", path: "/w/hello", reused: false };
const START = ["github", "start", "octocat/hello", "--root", "/w", "--mode", "card"];

const sent = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

/** The JSON a command printed; an empty output is `{}`, so a missing print fails by assertion. */
const asJson = (out: string[]) => JSON.parse(out.join("\n") || "{}");

const parsed = (argv: string[]): Record<string, unknown> => {
  try {
    return { ...parseArgs(argv) };
  } catch (error) {
    return { refusal: String((error as Error).message).split("\n")[0] };
  }
};

const refused = (argv: string[], text: string) =>
  expect(parsed(argv)).toHaveProperty("refusal", expect.stringContaining(text));

describe("the github write arguments (issue #3703)", () => {
  test("login, login --cancel, logout --confirm and start carry their words and flags", () => {
    expect(parsed(["github", "login", "--host", "pi", "--json"])).toMatchObject({
      command: "github",
      action: "login",
      host: "pi",
      json: true,
    });
    expect(parsed(["github", "login", "--cancel"])).toMatchObject({
      action: "login",
      githubCancel: true,
    });
    expect(parsed(["github", "logout", "--confirm"])).toMatchObject({
      action: "logout",
      confirm: true,
    });
    expect(parsed([...START, "--issue", "7"])).toMatchObject({
      action: "start",
      githubWords: ["octocat/hello"],
      projectRoot: "/w",
      githubMode: "card",
      githubIssue: "7",
    });
    expect(
      parsed(["github", "start", "octocat/hello", "--root", "/w", "--mode", "session"]),
    ).toMatchObject({ githubMode: "session" });
  });

  test("a start needs the repository, the folder and the mode, each of the right shape", () => {
    refused(["github", "start", "--root", "/w", "--mode", "card"], "the repository");
    refused(["github", "start", "octocat/hello", "--mode", "card"], "--root");
    refused(["github", "start", "octocat/hello", "--root", "/w"], "--mode");
    refused(["github", "start", "octocat/hello", "--root", "/w", "--mode", "pr"], "--mode");
    refused(["github", "start", "hello", "--root", "/w", "--mode", "card"], "owner/name");
    refused(["github", "start", "a/b/c", "--root", "/w", "--mode", "card"], "owner/name");
    refused([...START, "--issue", "seven"], "--issue");
    refused([...START, "--issue", "0"], "--issue");
    refused(["github", "start", "a/b", "c/d", "--root", "/w", "--mode", "card"], "c/d");
    refused(["github", "start", "octocat/hello", "--root", " ", "--mode", "card"], "--root");
  });

  test("a logout needs --confirm, and login and logout take no operand", () => {
    refused(["github", "logout"], "--confirm");
    refused(["github", "logout", "--confirm", "extra"], "extra");
    refused(["github", "login", "extra"], "extra");
    refused(["github", "logout", "--cancel", "--confirm"], "--cancel");
  });

  test("each flag is refused on the verbs and commands that do not take it", () => {
    refused(["github", "repos", "--root", "/w"], "--root");
    refused(["github", "status", "--mode", "card"], "--mode");
    refused(["github", "issues", "octocat/hello", "--issue", "7"], "--issue");
    refused(["github", "login", "--confirm"], "--confirm");
    refused([...START, "--confirm"], "--confirm");
    refused(["github", "status", "--cancel"], "--cancel");
    refused(["account", "get", "--issue", "1"], "--issue");
    refused(["account", "get", "--root", "/w"], "--root");
    refused(["file", "search", "card:c1", "--query", "q", "--mode", "card"], "--mode");
  });

  test("the flags the other commands own keep working", () => {
    expect(
      parsed(["project", "clone", "https://github.com/a/b.git", "--root", "/w", "--confirm"]),
    ).toMatchObject({ command: "project", projectRoot: "/w" });
    expect(
      parsed(["file", "search", "card:c1", "--query", "q", "--mode", "content"]),
    ).toMatchObject({
      fileMode: "content",
    });
  });
});

describe("flightdeckd github login (issue #3703)", () => {
  test("it prints the one-time code and the page, and says to type it there", async () => {
    const daemon = fakeDaemon({ "github.login.start": () => DEVICE });
    const run = await flightdeckd(["github", "login"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "one-time code: ABCD-1234",
      "open https://github.com/login/device and type the code there; run flightdeckd github status to see when the sign-in is done",
    ]);
    expect(sent(daemon, "github.login.start")).toEqual([{}]);
  });

  test("--json prints the code and the page", async () => {
    const daemon = fakeDaemon({ "github.login.start": () => DEVICE });
    const run = await flightdeckd(["github", "login", "--json"], daemon.port);
    expect(asJson(run.out)).toEqual(DEVICE);
  });

  test("a host without gh is exit 1 with the daemon's text", async () => {
    const daemon = fakeDaemon({
      "github.login.start": () => ({
        error: { code: "invalid_state", message: "gh is not installed on this host" },
      }),
    });
    const run = await flightdeckd(["github", "login"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("gh is not installed on this host"),
    ]);
  });

  test("--cancel ends the running sign-in and says so", async () => {
    const daemon = fakeDaemon({ "github.login.cancel": () => ({}) });
    const run = await flightdeckd(["github", "login", "--cancel"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["the sign-in was cancelled"],
    });
    expect(sent(daemon, "github.login.cancel")).toEqual([{}]);
    expect(sent(daemon, "github.login.start")).toEqual([]);
  });

  test("a daemon that dies after the sign-in started: exit 2, and it may or may not be running", async () => {
    const daemon = fakeDaemon({ "github.login.start": () => CLOSE });
    const run = await flightdeckd(["github", "login"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
    expect(run.err.join("\n")).toContain("github login --cancel");
  });
});

describe("flightdeckd github logout (issue #3703)", () => {
  test("it signs the host out and says so, and --json prints that", async () => {
    const daemon = fakeDaemon({ "github.logout": () => ({}) });
    const run = await flightdeckd(["github", "logout", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["signed out of GitHub on this host"],
    });
    const json = await flightdeckd(["github", "logout", "--confirm", "--json"], daemon.port);
    expect(asJson(json.out)).toEqual({ loggedOut: true });
    expect(sent(daemon, "github.logout")).toEqual([{}, {}]);
  });

  test("a login that comes from the daemon's environment is refused with the daemon's text", async () => {
    const daemon = fakeDaemon({
      "github.logout": () => ({
        error: {
          code: "invalid_state",
          message: "the login comes from an environment variable of the daemon",
        },
      }),
    });
    const run = await flightdeckd(["github", "logout", "--confirm"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("environment variable"),
    ]);
  });

  test("a daemon that dies after the logout was sent: exit 2, and check with github status", async () => {
    const daemon = fakeDaemon({ "github.logout": () => CLOSE });
    const run = await flightdeckd(["github", "logout", "--confirm"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
    expect(run.err.join("\n")).toContain("github status");
  });
});

describe("flightdeckd github start (issue #3703)", () => {
  test("a card start sends the repository, the folder and the mode, and says what it made", async () => {
    const daemon = fakeDaemon({ "github.start": () => ({ ...STARTED, cardId: "c9" }) });
    const run = await flightdeckd([...START, "--issue", "7"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["cloned into /w/hello", "project p1", "card c9"]);
    expect(sent(daemon, "github.start")).toEqual([
      { repo: "octocat/hello", root: "/w", mode: "card", issue: "7" },
    ]);
  });

  test("a session start on a folder that was already a clone says it reused it, and names the session", async () => {
    const daemon = fakeDaemon({
      "github.start": () => ({ ...STARTED, reused: true, sessionId: "s1" }),
    });
    const run = await flightdeckd(
      ["github", "start", "octocat/hello", "--root", "/w", "--mode", "session"],
      daemon.port,
    );
    expect(run.out).toEqual(["reused the clone in /w/hello", "project p1", "session s1"]);
    expect(sent(daemon, "github.start")).toEqual([
      { repo: "octocat/hello", root: "/w", mode: "session" },
    ]);
  });

  test("--json prints the result as the daemon sent it", async () => {
    const daemon = fakeDaemon({ "github.start": () => STARTED });
    const run = await flightdeckd([...START, "--json"], daemon.port);
    expect(asJson(run.out)).toEqual(STARTED);
  });

  test("a refusal is exit 1 with the daemon's text, and no daemon is exit 2", async () => {
    const daemon = fakeDaemon({
      "github.start": () => ({
        error: { code: "invalid_state", message: "/w/hello already exists and is not a clone" },
      }),
    });
    const run = await flightdeckd(START, daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("already exists and is not a clone"),
    ]);
    const { port } = daemon;
    await stopAll();
    expect((await flightdeckd(START, port)).code).toBe(2);
  });

  test("a daemon that dies after the start was sent: exit 2, and look at the board before running it again", async () => {
    const daemon = fakeDaemon({ "github.start": () => CLOSE });
    const run = await flightdeckd(START, daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
    expect(run.err.join("\n")).toContain("project list");
  });
});
