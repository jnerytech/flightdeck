import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";
const REASON =
  "replaces a file of a session's, a card's, a terminal's or a project's checkout, without the person opening it in the app and saving it; a typed --confirm or --hash is not the person (flightdeckd file write)";

describe("risk rules: a session writing a file of a checkout from its shell (#3624)", () => {
  test("file write is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd file write card:c1 src/a.ts --file next.ts --hash abc --confirm", REASON],
        ["flightdeckd file write session:s1 a.ts --file - --hash abc", REASON],
        ["fd --json file write terminal:t1 a.ts", REASON],
        ["flightdeckd --config /x/y.json file write project:p1 a.ts", REASON],
        ["bun run apps/daemon/src/bin.ts file write card:c1 a.ts", REASON],
        ["bunx flightdeckd file write card:c1 a.ts", REASON],
        ["FLIGHTDECK_X=1 fd file write card:c1 a.ts", REASON],
        ['fd file "write" card:c1 a.ts', REASON],
        ["fd file read card:c1 a.ts && fd file write card:c1 a.ts --file x", REASON],
        ['bash -c "fd file write card:c1 a.ts --file x"', REASON],
        ["fd --host pc file write card:c1 a.ts --file x", REASON],
        ["fd --hash 'a b' file write c a.ts", REASON],
      ]),
    ).toEqual([]);
  });

  test("the file reads stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd file list card:c1 --dir src",
        "fd file read card:c1 src/a.ts",
        "fd file search card:c1 --mode content --query write",
        "fd file dirs /work",
        "fd file files /work/api --hidden",
        "fd --json file read card:c1 write",
        "fd card list --project file",
        "echo file write",
        "git file write",
        "ls file/write",
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands is high with the reason that says why", () => {
    expect(
      wrongReasons([
        ["V=write; fd file $V card:c1 a.ts", HIDDEN],
        ["fd file w* card:c1 a.ts", HIDDEN],
        ["fd file wr[i]te card:c1 a.ts", HIDDEN],
      ]),
    ).toEqual([]);
  });
});
