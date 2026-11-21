import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../src/cli/domain/args.ts";
import { CONFIRM_OWNERS, HOST_COMMANDS, JSON_COMMANDS } from "../../src/cli/domain/command-sets.ts";

const alphabetical = (list: readonly string[]) =>
  [...list].sort((a, b) => (a < b ? -1 : Number(a > b)));

describe("the command lists of the parser (#3759)", () => {
  test("each is in alphabetical order with no name twice, so two PRs that add a command do not edit the same place", () => {
    for (const list of [JSON_COMMANDS, HOST_COMMANDS, CONFIRM_OWNERS]) {
      expect(list).toEqual(alphabetical(list));
      expect(new Set(list).size).toBe(list.length);
    }
  });

  test("a flag on a command outside its list is refused with the whole list, in that order", () => {
    const names = (list: readonly string[]) => `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
    expect(() => parseArgs(["doctor", "--host", "server"])).toThrow(
      `--host: this flag only applies to flightdeckd ${names(HOST_COMMANDS)}`,
    );
    expect(() => parseArgs(["doctor", "--json"])).toThrow(
      `--json: this flag only applies to flightdeckd ${names(JSON_COMMANDS)}`,
    );
  });
});
