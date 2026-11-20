import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { CLOSE, fakeDaemon, HOST, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const ONE_PROJECT = {
  "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 2 }),
};
const RULE = "Bash(bun test:*)";
const SUSPENDED = {
  sessionKey: "s7",
  reason: "third-party content",
  at: "2026-11-20T08:00:00.000Z",
};
const OTHER = { ...SUSPENDED, sessionKey: "s9" };

describe("flightdeckd rules remove (issue #3457)", () => {
  const REMOVE = ["rules", "remove", RULE, "--project", "api", "--confirm"];
  const HANDLERS = { ...HOST, "rules.remove": () => ({ rules: ["Edit(src/**)"] }) };

  test("removes the rule, sends the project id, the exact rule and confirm, and exits 0", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(REMOVE, daemon.port);
    expect(run.code).toBe(0);
    expect(run.err).toEqual([]);
    expect(run.out).toEqual([`removed ${RULE} from api, 1 rule left`]);
    expect(daemon.calls.find((c) => c.type === "rules.remove")?.payload).toEqual({
      projectId: "p1",
      rule: RULE,
      confirm: true,
    });
  });

  test("--json prints the rules that are left", async () => {
    const run = await flightdeckd([...REMOVE, "--json"], fakeDaemon(HANDLERS).port);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual(["Edit(src/**)"]);
  });

  test("without --confirm nothing is sent, and the line says to pass it", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(["rules", "remove", RULE, "--project", "api"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("cannot be undone: pass --confirm");
    expect(daemon.calls).toEqual([]);
  });

  test("without the rule nothing is sent", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(
      ["rules", "remove", "--project", "api", "--confirm"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("missing rule");
    expect(daemon.calls).toEqual([]);
  });

  test("a host with several projects and no --project is refused, and nothing is removed", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(["rules", "remove", RULE, "--confirm"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("web");
    expect(daemon.calls.some((c) => c.type === "rules.remove")).toBe(false);
  });

  test("a rule the project does not have is the daemon's refusal: exit 1 with its reason", async () => {
    const daemon = fakeDaemon({
      ...ONE_PROJECT,
      "rules.remove": () => ({
        error: { code: "not_found", message: `rule ${RULE} does not exist` },
      }),
    });
    const run = await flightdeckd(["rules", "remove", RULE, "--confirm"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("does not exist");
  });

  test("a daemon that dies after the removal was sent: exit 2, and it may or may not have gone in", async () => {
    const daemon = fakeDaemon({ ...HOST, "rules.remove": () => CLOSE });
    const run = await flightdeckd(REMOVE, daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });

  test("the flags of other commands are refused before anything is sent", async () => {
    const daemon = fakeDaemon(HANDLERS);
    for (const flags of [
      ["--session", "s1"],
      ["--limit", "5"],
    ]) {
      const run = await flightdeckd([...REMOVE, ...flags], daemon.port);
      expect(run.code).toBe(1);
      expect(run.err.join("\n")).toContain("this flag only applies");
    }
    expect(daemon.calls).toEqual([]);
  });
});

describe("flightdeckd autoapprove resume (issue #3457)", () => {
  const RESUME = ["autoapprove", "resume", "--session", "s7", "--confirm"];
  const HANDLERS = {
    "autoapprove.list": () => ({ decisions: [], suspended: [SUSPENDED, OTHER] }),
    "autoapprove.resume": () => ({ suspended: [OTHER] }),
  };

  test("resumes the session, sends its key and confirm, and exits 0", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(RESUME, daemon.port);
    expect(run.code).toBe(0);
    expect(run.err).toEqual([]);
    expect(run.out).toEqual(["automatic approval resumed for s7"]);
    expect(daemon.calls.find((c) => c.type === "autoapprove.resume")?.payload).toEqual({
      sessionKey: "s7",
      confirm: true,
    });
  });

  test("--json prints the sessions that are still suspended", async () => {
    const run = await flightdeckd([...RESUME, "--json"], fakeDaemon(HANDLERS).port);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual({ suspended: [OTHER] });
  });

  test("a session that is not suspended is refused, and nothing is resumed", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(
      ["autoapprove", "resume", "--session", "s1", "--confirm"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("s1");
    expect(daemon.calls.some((c) => c.type === "autoapprove.resume")).toBe(false);
  });

  test("without --confirm, or without --session, nothing is sent", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const noConfirm = await flightdeckd(["autoapprove", "resume", "--session", "s7"], daemon.port);
    expect(noConfirm.code).toBe(1);
    expect(noConfirm.err.join("\n")).toContain("cannot be undone: pass --confirm");
    const noSession = await flightdeckd(["autoapprove", "resume", "--confirm"], daemon.port);
    expect(noSession.code).toBe(1);
    expect(noSession.err.join("\n")).toContain("missing --session");
    expect(daemon.calls).toEqual([]);
  });

  test("--project and --limit do not apply to resume", async () => {
    const daemon = fakeDaemon(HANDLERS);
    for (const flags of [
      ["--project", "api"],
      ["--limit", "5"],
    ]) {
      const run = await flightdeckd([...RESUME, ...flags], daemon.port);
      expect(run.code).toBe(1);
      expect(run.err.join("\n")).toContain("this flag only applies");
    }
    expect(daemon.calls).toEqual([]);
  });

  test("a daemon that dies after the resume was sent: exit 2, and it may or may not have gone in", async () => {
    const daemon = fakeDaemon({ ...HANDLERS, "autoapprove.resume": () => CLOSE });
    const run = await flightdeckd(RESUME, daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });

  test("--confirm does not apply to list", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const run = await flightdeckd(["autoapprove", "list", "--confirm"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain(
      "this flag only applies to flightdeckd autoapprove resume",
    );
    expect(daemon.calls).toEqual([]);
  });
});
