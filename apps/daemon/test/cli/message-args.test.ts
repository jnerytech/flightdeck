import { describe, expect, test } from "bun:test";
import { messageAdminCliArgs } from "../../src/cli/domain/message-args.ts";
import { parseArgs } from "../../src/main.ts";

/** The parsed arguments, or what the parser refused with: a wrong parse fails an assertion. */
function parsed(argv: string[]): unknown {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { refusedWith: (error as Error).message };
  }
}

describe("the arguments of message history, watch and rules (issue #3622)", () => {
  test("history takes its filters and --json", () => {
    expect(parsed(["message", "history"])).toMatchObject({ command: "message", action: "history" });
    expect(
      parsed([
        "message",
        "history",
        "--team",
        "t1",
        "--session",
        "s-dev",
        "--with-host",
        "laptop",
        "--status",
        "queued",
        "--days",
        "7",
        "--limit",
        "50",
        "--json",
        "--host",
        "pi",
      ]),
    ).toMatchObject({
      command: "message",
      action: "history",
      messageTeam: "t1",
      session: "s-dev",
      withHost: "laptop",
      messageStatus: "queued",
      days: 7,
      limit: 50,
      json: true,
      host: "pi",
    });
  });

  test("watch and rules take --json and --host", () => {
    expect(parsed(["message", "watch", "--json"])).toMatchObject({ action: "watch", json: true });
    expect(parsed(["message", "rules", "--host", "pi"])).toMatchObject({
      action: "rules",
      host: "pi",
    });
  });

  test("a bad status, days or limit is refused", () => {
    expect(parsed(["message", "history", "--status", "lost"])).toMatchObject({
      refusedWith: expect.stringContaining("--status"),
    });
    expect(parsed(["message", "history", "--days", "0"])).toMatchObject({
      refusedWith: expect.stringContaining("--days"),
    });
    expect(parsed(["message", "history", "--limit", "2000"])).toMatchObject({
      refusedWith: expect.stringContaining("--limit"),
    });
  });

  test("a filter belongs to history only, and --json and --host to the three new verbs", () => {
    for (const [argv, flag] of [
      [["message", "watch", "--team", "t1"], "--team"],
      [["message", "rules", "--days", "3"], "--days"],
      [["message", "rules", "--status", "queued"], "--status"],
      [["message", "watch", "--limit", "5"], "--limit"],
      [["message", "rules", "--with-host", "laptop"], "--with-host"],
      [["message", "watch", "--session", "s-dev"], "--session"],
      [["message", "rules", "--session", "s-dev"], "--session"],
    ] as const)
      expect(parsed([...argv])).toMatchObject({
        refusedWith: expect.stringContaining(
          `${flag}: this flag only applies to flightdeckd message history`,
        ),
      });
    expect(parsed(["message", "send", "s-dev", "hi", "--json"])).toMatchObject({
      refusedWith: expect.stringContaining(
        "--json: this flag only applies to flightdeckd message history, watch and rules",
      ),
    });
    expect(parsed(["message", "list", "--host", "pi"])).toMatchObject({
      refusedWith: expect.stringContaining(
        "--host: this flag only applies to flightdeckd message history, watch and rules",
      ),
    });
  });

  test("the verbs that exist keep their arguments", () => {
    expect(parsed(["message", "list"])).toMatchObject({ command: "message", action: "list" });
    expect(parsed(["message", "read", "s-dev", "--last", "3"])).toMatchObject({
      action: "read",
      session: "s-dev",
      last: 3,
    });
  });

  test("the runner takes the filters that were given and nothing else, and only for the three admin verbs", () => {
    const admin = (argv: string[]) => messageAdminCliArgs(parseArgs(argv));
    expect(
      admin([
        "message",
        "history",
        "--team",
        "t1",
        "--session",
        "s-dev",
        "--with-host",
        "laptop",
        "--status",
        "refused",
        "--days",
        "7",
        "--limit",
        "50",
        "--json",
      ]),
    ).toEqual({
      action: "history",
      team: "t1",
      session: "s-dev",
      withHost: "laptop",
      status: "refused",
      days: 7,
      limit: 50,
      json: true,
    });
    expect(admin(["message", "rules"])).toEqual({ action: "rules" });
    expect(admin(["message", "send", "s-dev", "hi"])).toBeUndefined();
  });
});
