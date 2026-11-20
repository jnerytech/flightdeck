import { describe, expect, test } from "bun:test";
import { parityCheck, protocolCommands } from "../../lib/arch/cli-parity.ts";

const table = (rows: Record<string, unknown>) => JSON.stringify(rows);

describe("protocolCommands (#3428)", () => {
  test("reads the name of a cmd entry on one line or split over lines, once and sorted", () => {
    const source = [
      'export const a = [cmd("session.list", z.object({})), cmd("host.info", z.object({}))];',
      "export const b = [",
      "  cmd(",
      '    "permission.respond",',
      "    z.object({}),",
      "  ),",
      '  cmd("session.list", z.object({})),',
      "];",
    ].join("\n");
    expect(protocolCommands([source])).toEqual(["host.info", "permission.respond", "session.list"]);
  });

  test("a name that merely contains cmd is not a command entry", () => {
    expect(protocolCommands(['const x = mycmd("a.b", 1); const y = cmd2("c.d", 2);'])).toEqual([]);
  });
});

describe("parityCheck (#3428)", () => {
  const commands = ["session.list", "session.send", "window.focus"];
  const cliCommands = ["sessions", "send"];

  test("a command covered by a CLI command or marked app-only is not a gap; an empty row is", () => {
    const result = parityCheck({
      commands,
      cliCommands,
      table: table({
        "session.list": { cli: "sessions" },
        "session.send": {},
        "window.focus": { appOnly: "it moves the app window" },
      }),
    });
    expect(result).toEqual({ gaps: ["session.send"], problems: [] });
  });

  test("a command with no row is a problem that names it", () => {
    const result = parityCheck({
      commands,
      cliCommands,
      table: table({ "session.list": { cli: "sessions" }, "session.send": { cli: "send" } }),
    });
    expect(result.problems).toEqual([expect.stringContaining("window.focus")]);
  });

  test("a row that names a CLI command that does not exist is a problem that names the row", () => {
    const result = parityCheck({
      commands,
      cliCommands,
      table: table({
        "session.list": { cli: "list-all" },
        "session.send": { cli: "send" },
        "window.focus": { appOnly: "app window" },
      }),
    });
    expect(result.problems).toEqual([expect.stringContaining("session.list")]);
    expect(result.problems[0]).toContain("list-all");
  });

  test("an app-only row with no reason is a problem that names the row", () => {
    const result = parityCheck({
      commands,
      cliCommands,
      table: table({
        "session.list": { cli: "sessions" },
        "session.send": { cli: "send" },
        "window.focus": { appOnly: "  " },
      }),
    });
    expect(result.problems).toEqual([expect.stringContaining("window.focus")]);
  });

  test("a missing or unreadable table is one problem and every command is a gap", () => {
    for (const bad of [null, "{not json"]) {
      const result = parityCheck({ commands, cliCommands, table: bad });
      expect(result.problems).toHaveLength(1);
      expect(result.gaps).toEqual(commands);
    }
  });
});
