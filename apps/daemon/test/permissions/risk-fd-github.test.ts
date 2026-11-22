import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const LOGIN =
  "starts the GitHub device sign-in of this host, whose one-time code a person types on github.com, which the app asks the person to start (flightdeckd github login)";
const LOGOUT =
  "signs this host out of GitHub, which ends every feature that reads its repositories and issues and which the app asks the person to confirm (flightdeckd github logout)";
const START =
  "clones a repository into a folder of this host and opens a card or a Claude session on it, with an issue's text as the prompt, which the app asks the person to confirm (flightdeckd github start)";
const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: github login, logout and start, from a session's shell (#3703)", () => {
  test("login, with or without --cancel, is high however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd github login", LOGIN],
        ["fd github login --cancel", LOGIN],
        ["flightdeckd --host pi github login --json", LOGIN],
        ["flightdeckd fd github login", LOGIN],
        ["bunx flightdeckd github login", LOGIN],
        ["bun run start github login", LOGIN],
        ['bash -c "fd github login"', LOGIN],
        ["fd github status && fd github login", LOGIN],
      ]),
    ).toEqual([]);
  });

  test("logout is high with or without --confirm", () => {
    expect(
      wrongReasons([
        ["fd github logout --confirm", LOGOUT],
        ["fd github logout", LOGOUT],
        ["flightdeckd --host pi github logout --confirm --json", LOGOUT],
        ["flightdeckd fd github logout --confirm", LOGOUT],
        ['bash -c "fd github logout --confirm"', LOGOUT],
      ]),
    ).toEqual([]);
  });

  test("start is high, with an issue or without, in either mode", () => {
    expect(
      wrongReasons([
        ["fd github start octocat/hello --root /w --mode card", START],
        ["fd github start octocat/hello --root /w --mode session --issue 7", START],
        ["flightdeckd --host pi github start octocat/hello --root /w --mode card --json", START],
        ["flightdeckd fd github start octocat/hello --root /w --mode card", START],
        ["bunx flightdeckd github start octocat/hello --root /w --mode card", START],
        ['bash -c "fd github start octocat/hello --root /w --mode card"', START],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be one of these, so it is high", () => {
    expect(
      wrongReasons([
        ["fd github $V", HIDDEN],
        ["fd github $V octocat/hello --root /w --mode card", HIDDEN],
        ["fd $N login", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("a github line that xargs finishes with one of these verbs is high", () => {
    expect(wrongReasons([["echo logout --confirm | xargs fd github", HIDDEN]])).toEqual([]);
  });

  test("the reads stay ordinary, and so do words that only mention these verbs", () => {
    expect(
      notHigh([
        "fd github status",
        "fd github status --json --host pi",
        "fd github repos --query hello",
        "fd github issues octocat/hello",
        "fd account get",
        "fd account refresh --json",
        "fd account watch",
        "echo fd github login",
        "grep -n 'github logout' notes.md",
        "git commit -m 'github start docs'",
        "gh auth status",
      ]),
    ).toEqual([]);
  });
});
