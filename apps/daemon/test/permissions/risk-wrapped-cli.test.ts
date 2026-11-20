import { describe, expect, test } from "bun:test";
import { bash, notHigh } from "../support/permissions-risk-rules.ts";

/** One high-risk verb of every CLI rule, as the plain call types it (the program comes first). */
const VERBS: Record<string, string> = {
  "approve or deny": "approve r1 --hold",
  approvers: "approvers reset",
  "card end": "card delete c1 --confirm",
  "card check-loop on": "card check-loop c1 on",
  "card forced move": "card move c1 review --force",
  persona: "persona remove p1 --confirm",
  team: "team delete t1 --confirm",
  "history resume": "history resume abc --force",
  rules: "rules remove r1 --confirm",
  autoapprove: "autoapprove resume s1",
};

/** The same call in a form a shell reads as the same call; `%` is the call as the plain form types it. */
const WRAPS: Record<string, string> = {
  subshell: "(%)",
  "spaced subshell": "( % )",
  "brace group": "{ %; }",
  "negated call": "! %",
  "if branch": "if true; then %; fi",
  "while body": "while true; do %; done",
  timeout: "timeout 5 %",
  "timeout with a signal": "timeout -s KILL 5 %",
  "timeout with two options": "timeout --preserve-status -k 2 5s %",
  nice: "nice %",
  "nice with a value": "nice -n 5 %",
  ionice: "ionice -c 2 -n 3 %",
  stdbuf: "stdbuf -oL %",
  setsid: "setsid %",
  command: "command %",
  exec: "exec %",
  env: "env X=1 %",
  "env with an option": "env -i X=1 %",
  nested: "timeout 5 nice -n 5 env X=1 %",
  "a shell string": "sh -c '%'",
  "a shell string, wrapped inside": 'bash -c "timeout 5 %"',
};

const level = (command: string) => {
  const got = bash(command);
  return `${got.level}: ${got.reason}`;
};

describe("risk rules: a wrapped flightdeckd call is rated as the plain one (#3499)", () => {
  test("every verb is high in its plain form, so the table below compares with something", () => {
    const plain = Object.entries(VERBS).filter(
      ([, args]) => !level(`fd ${args}`).startsWith("high"),
    );
    expect(plain).toEqual([]);
  });

  test("a subshell, a brace group, a wrapper or a keyword in front changes neither level nor reason", () => {
    const wrong: string[] = [];
    for (const [rule, args] of Object.entries(VERBS))
      for (const [wrap, template] of Object.entries(WRAPS)) {
        const command = template.replace("%", `flightdeckd ${args}`);
        const want = level(`flightdeckd ${args}`);
        if (level(command) !== want)
          wrong.push(`${rule} / ${wrap}: ${command} -> ${level(command)}`);
      }
    expect(wrong).toEqual([]);
  });

  test("a program that is a variable is rated as the CLI when its arguments name a high-risk verb", () => {
    const wrong: string[] = [];
    for (const [rule, args] of Object.entries(VERBS))
      for (const program of ["$FD", '"$FD"', "${BIN}", '"${BIN}"', "$HOME/bin/$NAME"]) {
        const command = `${program} ${args}`;
        const want = level(`fd ${args}`);
        if (level(command) !== want) wrong.push(`${rule}: ${command} -> ${level(command)}`);
        const inShell = `sh -c '${command}'`;
        if (level(inShell) !== want) wrong.push(`${rule}: ${inShell} -> ${level(inShell)}`);
      }
    expect(wrong).toEqual([]);
  });

  test("a closing bracket glued to the last word does not hide a value", () => {
    const wrong: string[] = [];
    for (const args of [
      "card check-loop c1 on",
      "history resume abc --force",
      "card move c1 x --force",
    ])
      for (const command of [`(fd ${args})`, `{ fd ${args}}`, `(timeout 5 fd ${args})`])
        if (!level(command).startsWith("high")) wrong.push(`${command} -> ${level(command)}`);
    expect(wrong).toEqual([]);
  });

  test("a call run through a substitution, or eval is high, whatever its verb", () => {
    const wrong: string[] = [];
    for (const [rule, args] of Object.entries(VERBS))
      for (const command of [
        `echo $(fd ${args})`,
        `echo \`fd ${args}\``,
        `eval "fd ${args}"`,
        `eval fd ${args}`,
      ])
        if (!level(command).startsWith("high"))
          wrong.push(`${rule}: ${command} -> ${level(command)}`);
    expect(wrong).toEqual([]);
  });

  test("a wrapper in front of a harmless call, or a verb that is only text, stays an ordinary command", () => {
    expect(
      notHigh([
        "timeout 5 fd card list",
        "( fd card list )",
        "{ fd requests; }",
        "$FD card list",
        '"${BIN}" requests --json',
        "echo $FD card delete c1",
        "echo fd card delete c1",
        "nice -n 5 fd sessions",
        "env -i X=1 fd host --json",
        "if true; then fd card list; fi",
        "bash -c 'echo approve'",
        "sh -c '$FD card list'",
        'timeout 5 grep "fd card delete" notes.md',
      ]),
    ).toEqual([]);
  });
});
