import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";

/** What `flightdeckd claude --persona <id> ...` hands to the claude wrapper, as the parser reads it. */
const launch = (argv: string[]) => {
  const args = parseArgs(argv);
  return { command: args.command, claudeArgs: args.claudeArgs };
};

describe("persona shortcuts: one word opens claude with a persona (#3426)", () => {
  test("`flightdeckd architect` reads as `flightdeckd claude --persona <the architect's id>`", () => {
    expect(launch(["architect"])).toEqual(launch(["claude", "--persona", "arquiteto"]));
  });

  test("each of the four words names its own pack persona", () => {
    expect(
      ["architect", "reviewer", "security", "coordinator"].map((w) => launch([w]).claudeArgs),
    ).toEqual([
      ["--persona", "arquiteto"],
      ["--persona", "revisor"],
      ["--persona", "seguranca"],
      ["--persona", "coordenador"],
    ]);
  });

  test("the arguments after the word go to claude after the persona's, untouched", () => {
    expect(launch(["architect", "-p", "list the files", "--model", "opus"]).claudeArgs).toEqual([
      "--persona",
      "arquiteto",
      "-p",
      "list the files",
      "--model",
      "opus",
    ]);
  });

  test("an argument that looks like a persona word, after the first, is claude's own text", () => {
    expect(launch(["reviewer", "-p", "architect"]).claudeArgs).toEqual([
      "--persona",
      "revisor",
      "-p",
      "architect",
    ]);
  });

  test("`flightdeckd new <id>` opens claude with that persona, whatever its id", () => {
    expect(launch(["new", "my-own-persona", "-c"])).toEqual(
      launch(["claude", "--persona", "my-own-persona", "-c"]),
    );
  });

  test("`flightdeckd new` without an id, or with a flag in its place, is refused with the usage", () => {
    for (const argv of [["new"], ["new", "-p", "x"], ["new", "--persona"]]) {
      expect(() => parseArgs(argv), argv.join(" ")).toThrow(/missing persona id[\s\S]*usage:/);
    }
  });

  test("the usage lists the four words and `new`", () => {
    const usage = (() => {
      try {
        parseArgs(["--no-such-flag"]);
      } catch (error) {
        return (error as Error).message;
      }
      return "";
    })();
    expect([
      usage.includes("fd architect|reviewer|security|coordinator "),
      usage.includes("fd new <persona> "),
    ]).toEqual([true, true]);
  });
});
