import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const session = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  cwd: `/work/${name}`,
  status: "idle",
  permissionMode: "default",
  model: "claude-sonnet-5-5",
  claudeSessionId: `claude-${id}`,
  lastSeq: 7,
  createdAt: "2026-11-19T08:00:00.000Z",
  updatedAt: "2026-11-19T09:30:00.000Z",
  ...over,
});

const hasControl = (text: string) => [...text].some((c) => c.charCodeAt(0) < 32 && c !== "\n");

const TWO = {
  "session.list": () => ({
    sessions: [
      session("s1", "api"),
      session("s2", "web", { status: "running", permissionMode: "acceptEdits" }),
    ],
  }),
};

describe("flightdeckd sessions (issue #3424)", () => {
  test("--json prints one array with a small object per session, and exits 0", async () => {
    const run = await flightdeckd(["sessions", "--json"], fakeDaemon(TWO).port);
    expect(run.code).toBe(0);
    expect(run.err).toEqual([]);
    expect(run.out).toHaveLength(1);
    expect(JSON.parse(run.out.join("\n"))).toEqual([
      {
        id: "s1",
        name: "api",
        cwd: "/work/api",
        status: "idle",
        permissionMode: "default",
        updatedAt: "2026-11-19T09:30:00.000Z",
      },
      {
        id: "s2",
        name: "web",
        cwd: "/work/web",
        status: "running",
        permissionMode: "acceptEdits",
        updatedAt: "2026-11-19T09:30:00.000Z",
      },
    ]);
  });

  test("without --json each session is one line: name, status, folder", async () => {
    const run = await flightdeckd(["sessions"], fakeDaemon(TWO).port);
    expect(run.code).toBe(0);
    expect(run.out).toEqual(["api  idle  /work/api", "web  running  /work/web"]);
  });

  test("a daemon with no sessions gives an empty array, and exits 0", async () => {
    const daemon = fakeDaemon({ "session.list": () => ({ sessions: [] }) });
    const run = await flightdeckd(["sessions", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out).toHaveLength(1);
    expect(JSON.parse(run.out.join("\n"))).toEqual([]);
  });

  test("the name and the folder of a session cannot drive the terminal or hide text", async () => {
    const daemon = fakeDaemon({
      "session.list": () => ({
        sessions: [session("s1", "evil\u001b[2Jname\u2060x", { cwd: "/w/\u001b]0;pwn\u0007x" })],
      }),
    });
    const human = await flightdeckd(["sessions"], daemon.port);
    expect(human.out).toEqual(["evil [2Jname x  idle  /w/ ]0;pwn x"]);
    const machine = await flightdeckd(["sessions", "--json"], daemon.port);
    expect(JSON.parse(machine.out.join("\n"))[0]).toMatchObject({
      name: "evil [2Jname x",
      cwd: "/w/ ]0;pwn x",
    });
    expect(hasControl(machine.out.join(""))).toBe(false);
  });

  test("a session with no name is shown as (unnamed) and stays null in --json", async () => {
    const daemon = fakeDaemon({
      "session.list": () => ({ sessions: [session("s1", "x", { name: null })] }),
    });
    const human = await flightdeckd(["sessions"], daemon.port);
    expect(human.out).toEqual(["(unnamed)  idle  /work/x"]);
    const machine = await flightdeckd(["sessions", "--json"], daemon.port);
    expect(JSON.parse(machine.out.join("\n"))[0].name).toBeNull();
  });

  test("no daemon at the address of the config: a line on stderr and exit 2", async () => {
    const daemon = fakeDaemon({});
    const port = daemon.port;
    await stopAll();
    const run = await flightdeckd(["sessions"], port);
    expect(run.code).toBe(2);
    expect(run.out).toEqual([]);
    expect(run.err.join("\n")).toContain("could not reach the daemon");
  });

  test("--token is refused with exit 1 and nothing is sent to the daemon", async () => {
    const daemon = fakeDaemon(TWO);
    const run = await flightdeckd(["sessions", "--token", "x"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("read from the config file only");
    expect(daemon.calls).toEqual([]);
  });
});
