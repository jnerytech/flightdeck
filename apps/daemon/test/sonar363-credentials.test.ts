import { describe, expect, test } from "bun:test";
import { withoutCredentials } from "../src/board/publish-pr.ts";

/** #363 (Sonar S8786): the address scrub gives the same text for the same input, edge cases included. */
describe("sonar363-credentials: withoutCredentials", () => {
  test("cuts user, password, query and fragment, keeps scheme, host and path", () => {
    expect(withoutCredentials("fatal: https://ana:s3cret@github.com/o/r.git?x=1#top failed")).toBe(
      "fatal: https://github.com/o/r.git failed",
    );
    expect(withoutCredentials("ssh://git@host:2222/path")).toBe("ssh://host:2222/path");
    expect(withoutCredentials("https://github.com/o/r")).toBe("https://github.com/o/r");
  });

  test("a password that holds an @ is cut up to the last @ before the path", () => {
    expect(withoutCredentials("https://ana:p@ss@host/o/r")).toBe("https://host/o/r");
    expect(withoutCredentials("https://ana:p@ss@host?token=abc")).toBe("https://host");
  });

  test("an @ after the path is not a credential", () => {
    expect(withoutCredentials("https://host/o/r@v1")).toBe("https://host/o/r@v1");
  });

  test("every address in the text is cut, and the text around it stays", () => {
    expect(
      withoutCredentials("from 'http://u:p@a/x?t=1' to \"https://v:q@b/y#f\", then done"),
    ).toBe("from 'http://a/x' to \"https://b/y\", then done");
  });

  test("a scheme with + . - and digits counts, and a long run before it keeps its text", () => {
    expect(withoutCredentials("git+ssh://u@h/p")).toBe("git+ssh://h/p");
    expect(withoutCredentials("svn.x-1://u:p@h/p")).toBe("svn.x-1://h/p");
    const run = "abc.def-ghi+1".repeat(20);
    expect(withoutCredentials(`${run}://u:p@h/p`)).toBe(`${run}://h/p`);
    expect(withoutCredentials(`1${run}://u:p@h/p?t=1`)).toBe(`1${run}://h/p`);
    expect(withoutCredentials(`${run} no scheme here`)).toBe(`${run} no scheme here`);
    // A scheme the RFC would allow but nobody uses: still cut, however long.
    const digits = `a${"1".repeat(40)}`;
    expect(withoutCredentials(`${digits}://u:p@h/p`)).toBe(`${digits}://h/p`);
    expect(withoutCredentials(`${"1".repeat(40)}://u:p@h/p`)).toBe(`${"1".repeat(40)}://u:p@h/p`);
    expect(withoutCredentials("foo_bar://u:p@h/p")).toBe("foo_bar://h/p");
  });

  test("the scheme is case-insensitive and text with no address is untouched", () => {
    expect(withoutCredentials("HTTPS://U:P@H/X?T=1")).toBe("HTTPS://H/X");
    expect(withoutCredentials("")).toBe("");
    expect(withoutCredentials("plain error: not found")).toBe("plain error: not found");
  });
});
