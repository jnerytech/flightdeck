import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../src/cli/domain/args.ts";

/** What the parser made of a line, or the problem it refused it with (its first line). */
const parsed = (...argv: string[]) => {
  try {
    return parseArgs(argv);
  } catch (error) {
    return String((error as Error).message).split("\n")[0];
  }
};

describe("fd telemetry session and summary (issue #3755)", () => {
  test("session takes the Claude session id, --json and --host", () => {
    expect(parsed("telemetry", "session", "abc-123", "--json", "--host", "pi")).toMatchObject({
      command: "telemetry",
      action: "session",
      telemetryId: "abc-123",
      json: true,
      host: "pi",
    });
  });

  test("summary takes --json and --host, and no id", () => {
    expect(parsed("telemetry", "summary", "--host", "pi")).toMatchObject({
      command: "telemetry",
      action: "summary",
      host: "pi",
    });
  });

  test("session without an id is refused", () => {
    expect(parsed("telemetry", "session")).toBe("missing the session");
  });

  test("install, uninstall and status stay on this machine and say why a flag is refused", () => {
    expect(parsed("telemetry", "install", "--json")).toBe(
      "--json: this flag only applies to flightdeckd telemetry session and summary",
    );
    expect(parsed("telemetry", "uninstall", "--host", "pi")).toBe(
      "--host: this flag only applies to flightdeckd telemetry session and summary",
    );
    expect(parsed("telemetry", "status", "--config", "/x.json")).toMatchObject({
      command: "telemetry",
      action: "status",
    });
  });
});

describe("fd costs sessions (issue #3755)", () => {
  test("takes every id up to the first flag, then --json and --host", () => {
    expect(parsed("costs", "sessions", "a1", "b2", "--json", "--host", "pi")).toMatchObject({
      command: "costs",
      action: "sessions",
      costsIds: ["a1", "b2"],
      json: true,
      host: "pi",
    });
  });

  test("at least one id is needed", () => {
    expect(parsed("costs", "sessions", "--json")).toBe(
      "costs sessions: missing the id of a session",
    );
  });

  test("more than 500 ids are refused before the daemon is asked, and the text names the limit", () => {
    const ids = Array.from({ length: 501 }, (_, i) => `s${i}`);
    expect(parsed("costs", "sessions", ...ids)).toBe(
      "costs sessions: at most 500 sessions at a time, 501 given",
    );
    expect(parsed("costs", "sessions", ...ids.slice(0, 500))).toMatchObject({ action: "sessions" });
  });

  test("--host belongs to costs sessions alone", () => {
    expect(parsed("costs", "reprice", "--confirm", "--host", "pi")).toBe(
      "--host: this flag only applies to flightdeckd costs sessions",
    );
  });
});
