import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const request = (id: string, createdAt: string, over: Record<string, unknown> = {}) => ({
  requestId: id,
  toolName: "Bash",
  createdAt,
  input: { command: "bun test" },
  risk: "low",
  riskReason: "a test run",
  ...over,
});

const summary = (sessionId: string, name: string | null, pending: unknown[]) => ({
  type: "session.summary",
  sessionId,
  name,
  cwd: `/work/${name}`,
  status: "awaiting_permission",
  pendingPermissions: pending,
  updatedAt: "2026-11-19T09:30:00.000Z",
});

/** Two sessions whose requests interleave in time: the list is by time, not by session. */
const TWO = {
  "sessions.watch": () => ({
    summaries: [
      summary("s1", "api", [
        request("r1", "2026-11-19T09:00:00.000Z"),
        request("r4", "2026-11-19T09:20:00.000Z", { toolName: "Edit", risk: "medium" }),
      ]),
      summary("s2", "web", [request("r2", "2026-11-19T09:10:00.000Z", { risk: "high" })]),
      summary("s3", "idle-one", []),
    ],
  }),
};

const hasControl = (text: string) => [...text].some((c) => c.charCodeAt(0) < 32);

describe("flightdeckd requests (issue #3425)", () => {
  test("--json prints one array of the open requests of every session, oldest first, and exits 0", async () => {
    const daemon = fakeDaemon(TWO);
    const run = await flightdeckd(["requests", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.err).toEqual([]);
    const rows = JSON.parse(run.out.join("\n")) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2", "r4"]);
    expect(rows[1]).toEqual({
      id: "r2",
      sessionId: "s2",
      session: "web",
      tool: "Bash",
      risk: "high",
      riskReason: "a test run",
      createdAt: "2026-11-19T09:10:00.000Z",
      input: { command: "bun test" },
    });
    // The snapshot rides in the ack: nothing stays open on the daemon after the command.
    expect(daemon.calls.find((c) => c.type === "sessions.watch")?.payload).toEqual({
      snapshot: "ack",
    });
  });

  test("--session keeps the requests of one session, named by its name or its id", async () => {
    for (const ref of ["web", "s2"]) {
      const run = await flightdeckd(["requests", "--session", ref, "--json"], fakeDaemon(TWO).port);
      expect(run.code).toBe(0);
      expect((JSON.parse(run.out.join("\n")) as Array<{ id: string }>).map((r) => r.id)).toEqual([
        "r2",
      ]);
    }
  });

  test("a session nobody has is refused with exit 1 and a line that names it", async () => {
    const run = await flightdeckd(["requests", "--session", "ghost"], fakeDaemon(TWO).port);
    expect(run.code).toBe(1);
    expect(run.out).toEqual([]);
    expect(run.err.join("\n")).toContain("no such session: ghost");
  });

  test("a name two sessions share is refused with both of them listed", async () => {
    const daemon = fakeDaemon({
      "sessions.watch": () => ({
        summaries: [summary("s1", "api", []), summary("s9", "api", [])],
      }),
    });
    const run = await flightdeckd(["requests", "--session", "api"], daemon.port);
    expect(run.code).toBe(1);
    const text = run.err.join("\n");
    expect(text).toContain("s1");
    expect(text).toContain("s9");
  });

  test("without --json each request is one line: id, session, risk, tool and what it asks", async () => {
    const run = await flightdeckd(["requests"], fakeDaemon(TWO).port);
    expect(run.code).toBe(0);
    expect(run.out).toHaveLength(3);
    expect(run.out[0]).toBe('r1  api  low (a test run)  Bash  {"command":"bun test"}');
    expect(run.out[1]).toContain("r2  web  high (a test run)  Bash");
  });

  test("nothing open gives an empty array with --json and a line without it, both exit 0", async () => {
    const daemon = fakeDaemon({
      "sessions.watch": () => ({ summaries: [summary("s1", "api", [])] }),
    });
    const machine = await flightdeckd(["requests", "--json"], daemon.port);
    expect(machine.code).toBe(0);
    expect(JSON.parse(machine.out.join("\n"))).toEqual([]);
    const human = await flightdeckd(["requests"], daemon.port);
    expect(human.code).toBe(0);
    expect(human.out).toEqual(["no pending requests"]);
  });

  test("the session name and the input of a request cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      "sessions.watch": () => ({
        summaries: [
          summary("s1", "evil\u001b[2Jname", [
            request("r1", "2026-11-19T09:00:00.000Z", {
              input: { command: "x\u001b]0;pwn\u0007" },
            }),
          ]),
        ],
      }),
    });
    const human = await flightdeckd(["requests"], daemon.port);
    expect(human.out).toHaveLength(1);
    expect(human.out.some(hasControl)).toBe(false);
    const machine = await flightdeckd(["requests", "--json"], daemon.port);
    expect(machine.out.join("").length).toBeGreaterThan(2);
    expect(machine.out.some((line) => hasControl(line.replace(/\n/g, " ")))).toBe(false);
  });

  test("no daemon at the address of the config: a line on stderr and exit 2", async () => {
    const daemon = fakeDaemon({});
    const port = daemon.port;
    await stopAll();
    const run = await flightdeckd(["requests"], port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("could not reach the daemon");
  });

  test("--token is refused with exit 1 and nothing is sent to the daemon", async () => {
    const daemon = fakeDaemon(TWO);
    const run = await flightdeckd(["requests", "--token", "x"], daemon.port);
    expect(run.code).toBe(1);
    expect(daemon.calls).toEqual([]);
  });

  test("a secret in what a request asks is redacted, in the line and in the JSON (review finding)", async () => {
    const token = `ghp_${"a1B2c3D4e5".repeat(4)}`;
    const daemon = fakeDaemon({
      "sessions.watch": () => ({
        summaries: [
          summary("s1", "api", [
            request("r1", "2026-11-19T09:00:00.000Z", {
              input: { command: `curl -H "Authorization: Bearer ${token}" https://x.test` },
            }),
          ]),
        ],
      }),
    });
    const human = await flightdeckd(["requests"], daemon.port);
    const machine = await flightdeckd(["requests", "--json"], daemon.port);
    expect(human.out.join("\n")).not.toContain(token);
    expect(human.out.join("\n")).toContain("curl");
    expect(machine.out.join("\n")).not.toContain(token);
    expect(machine.out.join("\n")).toContain("[redacted]");
  });
});
