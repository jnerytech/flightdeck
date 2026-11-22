import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";
const REASON =
  "puts the files of a session's checkout back to an earlier turn, or to the state before the last rewind, which the app does only after the person has read the files and confirmed in its dialog; a typed --confirm is not the person (flightdeckd rewind apply or undo)";

describe("risk rules: a session rewinding its own checkout through flightdeckd from its shell (#3701)", () => {
  test("rewind apply and undo are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd rewind apply s1 2 --confirm", REASON],
        ["fd rewind undo s1 --confirm", REASON],
        ["flightdeckd rewind apply s1 2", REASON],
        ["fd --json rewind undo s1", REASON],
        ["flightdeckd --config /x/y.json rewind apply s1 0", REASON],
        ["fd --host pc rewind apply s1 2 --confirm", REASON],
        ["bunx flightdeckd rewind undo s1", REASON],
        ["bun run apps/daemon/src/bin.ts rewind apply s1 2", REASON],
        ["FLIGHTDECK_X=1 fd rewind undo s1", REASON],
        ['fd rewind "apply" s1 2', REASON],
        ["fd rewind preview s1 2 && fd rewind apply s1 2 --confirm", REASON],
        ['bash -c "fd rewind undo s1 --confirm"', REASON],
      ]),
    ).toEqual([]);
  });

  test("rewind undo --preview reads, but with --confirm in the line it is rated as the undo it may be (#4041)", () => {
    expect(
      wrongReasons([
        ["fd rewind undo s1 --preview --confirm", REASON],
        ["fd rewind undo s1 --confirm --preview", REASON],
        ["fd rewind undo s1 --confirm --host --preview", REASON],
        ["fd rewind undo s1 --preview --confirm=true", REASON],
        ["fd rewind undo s1 --preview && fd rewind undo s1 --confirm", REASON],
        ["fd rewind apply s1 2 --preview --confirm", REASON],
        ["fd rewind apply s1 2 --preview", REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be any of them, so it is high", () => {
    expect(
      wrongReasons([
        ["fd rewind $V s1 2", HIDDEN],
        ["bunx fd rewind ap[p]ly s1 2", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("the reads stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd rewind preview s1 2",
        "fd rewind undo s1 --preview",
        "fd --json rewind undo s1 --preview",
        "fd snapshots list s1",
        "fd snapshots files s1 2",
        "fd trace get s1",
        "fd rewind --help",
        "echo rewind apply",
        "git add rewind",
        "ls rewind/undo",
      ]),
    ).toEqual([]);
  });
});
