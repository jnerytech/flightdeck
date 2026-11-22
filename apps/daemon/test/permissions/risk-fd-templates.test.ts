import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const START =
  "starts a Claude session on a task template, with a prompt filled from the values and permissions the template sets, which the app asks the person to confirm (flightdeckd template start)";
const DELETE =
  "deletes a saved harness template folder from the host, which the app asks the person to confirm and a shell reaches with only a typed flag (flightdeckd harness templates delete)";

describe("risk rules: template start and harness templates delete, from a session's shell (#3738)", () => {
  test("template start is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd template start summarize --field folder=/w/docs", START],
        ["flightdeckd --host pi template start summarize --json", START],
        ["flightdeckd fd template start summarize", START],
        ["bunx flightdeckd template start summarize", START],
        ["bun run start template start summarize --language pt-BR", START],
        ['bash -c "fd template start summarize"', START],
        ["fd template list && fd template start summarize", START],
      ]),
    ).toEqual([]);
  });

  test("harness templates delete is high with or without --confirm", () => {
    expect(
      wrongReasons([
        ["fd harness templates delete node-api --confirm", DELETE],
        ["fd harness templates delete node-api", DELETE],
        ["flightdeckd --host pi harness templates delete node-api --confirm --json", DELETE],
        ["flightdeckd fd harness templates delete node-api --confirm", DELETE],
        ['bash -c "fd harness templates delete node-api --confirm"', DELETE],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be one of these, so it is high", () => {
    expect(
      wrongReasons([
        [
          "fd template $V summarize",
          "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does",
        ],
        ["fd harness templates $V node-api --confirm", DELETE],
      ]),
    ).toEqual([]);
  });

  test("a harness templates line that xargs finishes with delete is high (#3738)", () => {
    expect(
      wrongReasons([
        [
          "echo delete node-api --confirm | xargs fd harness templates",
          "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does",
        ],
      ]),
    ).toEqual([]);
  });

  test("the reads stay ordinary", () => {
    expect(
      notHigh([
        "fd template list",
        "fd template list --json --host pi",
        "fd task results docs-task",
        "fd task preview docs-task /w/docs/notes.txt",
        "fd harness templates list",
        "fd harness templates list --json --host pi",
        "echo fd template start summarize",
        "grep -n 'harness templates delete' notes.md",
        "git commit -m 'template start docs'",
      ]),
    ).toEqual([]);
  });
});
