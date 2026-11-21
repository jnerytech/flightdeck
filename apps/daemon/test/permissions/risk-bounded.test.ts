import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bash, notHigh } from "../support/permissions-risk-rules.ts";

setDefaultTimeout(30_000);

const UNREADABLE =
  "a command line too tangled to read in bounded time (nested shells, process substitutions, find -exec or a chain of variable programs), so it is not read as routine";

/** What the classifier says about a line, and how long it took (ms). */
function timed(command: string) {
  const start = performance.now();
  const risk = bash(command);
  return { level: risk.level, reason: risk.reason, ms: performance.now() - start };
}

// The unfixed classifier needs seconds for each of these (and minutes a few repeats more): a bound of a
// tenth of a second says the work is capped, and the loose margin keeps a busy machine from failing it.
const BOUND_MS = 400;

describe("risk rules: a crafted command line cannot stall the daemon (#3593)", () => {
  const tangled: Array<[string, string]> = [
    ["a shell inside a shell, 14 deep", "sh -c '".repeat(14) + "fd persona remove qa"],
    ["a variable program, 400 words long", "$a ".repeat(400) + "fd persona remove qa"],
    ["process substitutions, 14 deep", "cat " + "<(cat ".repeat(14) + "ls"],
    ["find -exec, 12 deep", "find . " + "-exec find . ".repeat(12) + "-exec ls ;"],
  ];

  test.each(tangled)("%s is high, with the reason that says why, and fast", (_name, command) => {
    const got = timed(command);
    expect([got.level, got.reason]).toEqual(["high", UNREADABLE]);
    expect(got.ms).toBeLessThan(BOUND_MS);
  });

  test("a long line that is only long stays an ordinary shell command", () => {
    expect(
      notHigh([
        `echo ${"word ".repeat(1000)}`,
        `git commit -m "${"word ".repeat(3000)}"`,
        "ls; ".repeat(300),
        "sh -c 'ls; ls; ls'",
        "bash -c \"sh -c 'echo hello'\"",
      ]),
    ).toEqual([]);
  });
});
