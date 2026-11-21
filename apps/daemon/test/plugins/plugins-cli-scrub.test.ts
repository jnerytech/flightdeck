import { describe, expect, test } from "bun:test";
import { plainChange } from "../../src/plugins/domain/plugins-cli-view.ts";

const plain = (message: string) => plainChange({ outcome: "failed", message }).message;

describe("plugins CLI: a URL's user and password never reach the terminal (#3524)", () => {
  test.each([
    ["https://u:p@h/x", "https://h/x"],
    ["git+ssh://u@h", "git+ssh://h"],
    [
      "fatal: unable to access 'https://u:tok@github.com/o/r.git/': 403",
      "fatal: unable to access 'https://github.com/o/r.git/': 403",
    ],
    ["a https://u:p@one/x and ssh://v@two/y", "a https://one/x and ssh://two/y"],
    ["https://h/path@with-at", "https://h/path@with-at"],
    ["https://u@h/p@q", "https://h/p@q"],
    ["HTTPS://U:P@H/x", "HTTPS://H/x"],
    ["1http://u@h", "1http://h"],
    ["x.y-z+w://u@h", "x.y-z+w://h"],
    ["http://a://u@h", "http://a://h"],
    ["://u@h", "://u@h"],
    ["+://u@h", "+://u@h"],
    ["https://h/x", "https://h/x"],
    ["user@host without a scheme", "user@host without a scheme"],
    ["https:// u@h", "https:// u@h"],
    ["", ""],
  ])("%j is shown as %j", (said, shown) => {
    expect(plain(said)).toBe(shown);
  });

  test("the command and the plugin of a shown command are cut too, the hash is not", () => {
    const change = plainChange({
      outcome: "needs-command-confirmation",
      message: "m",
      shownCommand: { command: "git clone https://u:p@h/r", plugin: "ssh://v@h/p", sha256: "ab" },
    });
    expect(change.shownCommand).toEqual({
      command: "git clone https://h/r",
      plugin: "ssh://h/p",
      sha256: "ab",
    });
  });

  test("a long run of scheme characters with no :// behind it is answered at once", () => {
    const started = performance.now();
    expect(plain("a".repeat(30_000))).toBe("a".repeat(30_000));
    expect(plain(`${"a1.".repeat(10_000)}://x@h`)).toBe(`${"a1.".repeat(10_000)}://h`);
    // timing: a linear scan takes milliseconds; a quadratic one takes seconds
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
