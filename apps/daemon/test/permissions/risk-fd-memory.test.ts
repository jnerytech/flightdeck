import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";
const WRITE =
  "writes or deletes a note in a project's auto memory, which every later session of the project loads at its start as its own memory, without the person reading it in the app; a typed --confirm or --expected-hash is not the person (flightdeckd memory write, memory delete)";

describe("risk rules: a session changing a project's auto memory from its shell (#3618)", () => {
  test("memory write and memory delete are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd memory write api tdd.md --file next.md --new --confirm", WRITE],
        ["fd memory delete api tdd.md --expected-hash abc --confirm", WRITE],
        ["flightdeckd memory write api tdd.md --file - --new", WRITE],
        ["fd --json memory delete api tdd.md", WRITE],
        ["flightdeckd --config /x/y.json memory write api tdd.md", WRITE],
        ["bun run apps/daemon/src/bin.ts memory write api tdd.md", WRITE],
        ["FLIGHTDECK_X=1 fd memory delete api tdd.md", WRITE],
        ['fd memory "write" api tdd.md', WRITE],
        ["fd memory list api && fd memory write api tdd.md --new", WRITE],
        ['bash -c "fd memory delete api tdd.md --confirm"', WRITE],
        ["bunx flightdeckd memory write api tdd.md", WRITE],
      ]),
    ).toEqual([]);
  });

  test("memory list, read, budget and suggest stay ordinary, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd memory list api",
        "fd memory read api tdd.md",
        "fd --json memory budget api",
        "fd memory suggest api",
        "fd memory --help",
        "fd card list --project write",
        "echo memory write",
        "git write memory",
        "ls memory/write",
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands, or an xargs line with no verb, is high with the reason that says why", () => {
    expect(
      wrongReasons([
        ["V=write; fd memory $V api tdd.md --new", HIDDEN],
        ["fd memory w* api", HIDDEN],
        ["fd memory wr[i]te api", HIDDEN],
        ["fd memory {write,list} api", HIDDEN],
        [String.raw`fd memory $'wr\x69te' api`, HIDDEN],
        ["bash -c 'fd memory $V api'", HIDDEN],
        ["echo write api tdd.md --new | xargs fd memory", HIDDEN],
        ["echo write | xargs -I{} fd memory {} api", HIDDEN],
      ]),
    ).toEqual([]);
  });
});
