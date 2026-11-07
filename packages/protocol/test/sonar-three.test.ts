import { describe, expect, test } from "bun:test";
import { SecretScanner, scrubHome } from "../src/snippets.ts";

const LIMIT_MS = 250;
const timed = <T>(run: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
};

const scanner = new SecretScanner();
const BEARER = "token Bearer";
const CURL = "senha do curl";
const AUTHORIZATION = "cabeçalho de autorização";

describe("sonar-three: a Bearer token is found whatever the case of its words (#363)", () => {
  test("the word and the token match in either case, from sixteen characters", () => {
    const cases: Array<[string, string[], string]> = [
      ["Bearer abcdefghijklmnop", [BEARER], "[redacted]"],
      ["bearer ABCDEFGHIJKLMNOPQRST", [BEARER], "[redacted]"],
      ["BEARER aBcDeFgHiJkLmNoPqR", [BEARER], "[redacted]"],
      ["Bearer  a.b~c+d/e=f-ghijkl!", [BEARER], "[redacted]!"],
      ["Bearer abcdefghijklmno", [], "Bearer abcdefghijklmno"],
      ["xBearer abcdefghijklmnop", [], "xBearer abcdefghijklmnop"],
    ];
    expect(cases.map(([text]) => scanner.scan(text))).toEqual(cases.map(([, kinds]) => kinds));
    expect(cases.map(([text]) => scanner.redact(text))).toEqual(cases.map(([, , clean]) => clean));
  });

  test("a very long token is read in linear time", () => {
    const token = timed(() => scanner.redact(`Bearer ${"aB0".repeat(7000)}`));
    expect(token.value).toBe("[redacted]");
    expect(token.ms).toBeLessThan(LIMIT_MS);
  });
});

describe("sonar-three: the home folder of a path becomes ~ (#363)", () => {
  test("the folders of Linux, macOS and Windows are matched in either case, with doubled backslashes too", () => {
    const cases: Array<[string, string]> = [
      ["see d:\\USERS\\Bob\\x", "see ~\\x"],
      ["C:\\\\Users\\\\Ana\\\\f", "~\\\\f"],
      ["Z:\\Users\\Zed", "~"],
      ["e:\\users\\\\q", "~"],
      ["/HOME/ana/x", "~/x"],
      ["/Users/Bo b/x", "~ b/x"],
      ["1:\\Users\\a", "1:\\Users\\a"],
    ];
    expect(cases.map(([text]) => scrubHome(text))).toEqual(cases.map(([, clean]) => clean));
  });

  test("a known home loses its trailing separators, of either kind, before it is replaced", () => {
    const cases: Array<[string, string, string]> = [
      ["a /srv/ana", "/srv/ana///", "a ~"],
      ["a /srv/ana", "/srv/ana\\/\\", "a ~"],
      ["a /srv/ana/b", "/srv/ana/", "a ~/b"],
      ["a /x/y b", "/x/y//", "a ~ b"],
      ["a ab", "ab", "a ab"],
      ["ab/c", "ab/", "ab/c"],
      ["a ///", "///", "a ///"],
    ];
    expect(cases.map(([text, home]) => scrubHome(text, home))).toEqual(
      cases.map(([, , clean]) => clean),
    );
  });

  test("a home with a very long run of separators in the middle is read in linear time", () => {
    const home = `x${"/".repeat(20_000)}y`;
    const run = timed(() => scrubHome(`in ${home} and /home/ana`, home));
    expect(run.value).toBe("in ~ and ~");
    expect(run.ms).toBeLessThan(LIMIT_MS);
  });
});

describe("sonar-three: the password of a curl command is found after -u or --user (#363)", () => {
  test("every credential after the flag of a curl command is a secret, and what is around it stays", () => {
    const cases: Array<[string, string[], string]> = [
      ["curl -u alice:s3cretpw https://x", [CURL], "curl -u [redacted] https://x"],
      ["curl --user alice:s3cretpw https://x", [CURL], "curl --user [redacted] https://x"],
      ["curl https://x -u bob:pw", [CURL], "curl https://x -u [redacted]"],
      ["curl -u a:b -u c:d", [CURL], "curl -u [redacted] -u [redacted]"],
      ["curl -u\nalice:pw", [CURL], "curl -u\n[redacted]"],
      ["curl  -u   alice:pw!x|y", [CURL], "curl  -u   [redacted]"],
      ["ls | curl -s -u u:p", [CURL], "ls | curl -s -u [redacted]"],
      ["curl a\n-u alice:pw", [CURL], "curl a\n-u [redacted]"],
      ["curl --user-agent x -u u:p", [CURL], "curl --user-agent x -u [redacted]"],
      ["curl -u -u a:b", [CURL], "curl -u -u [redacted]"],
      ["curl -u a:b;rm", [CURL], "curl -u [redacted]"],
      ["curl x; -u alice:pw", [], "curl x; -u alice:pw"],
      ["curl x | -u alice:pw", [], "curl x | -u alice:pw"],
      ["curl x\ncat -u alice:pw", [], "curl x\ncat -u alice:pw"],
      ["echo -u alice:pw", [], "echo -u alice:pw"],
      ["curl -u alice", [], "curl -u alice"],
      ["CURL -u a:b", [], "CURL -u a:b"],
      ["curl -u :pw", [], "curl -u :pw"],
      ["curl -u a:", [], "curl -u a:"],
      ["curl -user a:b", [], "curl -user a:b"],
      ["curl;-u a:b", [], "curl;-u a:b"],
      ["xcurl -u a:b", [], "xcurl -u a:b"],
    ];
    expect(cases.map(([text]) => scanner.scan(text))).toEqual(cases.map(([, kinds]) => kinds));
    expect(cases.map(([text]) => scanner.redact(text))).toEqual(cases.map(([, , clean]) => clean));
  });

  test("a placeholder in the credential is kept when asked, and redacted when not", () => {
    expect(scanner.redact("curl -u {{user}}:{{pass}} https://x")).toBe(
      "curl -u {{user}}:{{pass}} https://x",
    );
    expect(scanner.redact("curl -u {{user}}:{{pass}} https://x", false)).toBe(
      "curl -u [redacted] https://x",
    );
    expect(scanner.scan("curl -u {{user}}:{{pass}} https://x")).toEqual([]);
  });

  test("a curl word inside an earlier credential arms the next flag, and a separator inside one ends the command", () => {
    expect(scanner.redact("x -u a:curl -u c:d")).toBe("x -u a:curl -u [redacted]");
    expect(scanner.redact("curl -u a:b;c -u d:e")).toBe("curl -u [redacted] -u d:e");
  });

  test("a very long gap after the flag, and a very long line of flags, are read in linear time", () => {
    const gap = timed(() => scanner.scan(`${"x".repeat(10_000)} -u${" ".repeat(10_000)}`));
    const lone = timed(() => scanner.redact(`curl x -u${" ".repeat(20_000)}`));
    const flags = timed(() => scanner.scan(`x ${"-u y ".repeat(4000)}`));
    expect(gap.value).toEqual([]);
    expect(lone.value.length).toBe(20_009);
    expect(flags.value).toEqual([]);
    expect(gap.ms).toBeLessThan(LIMIT_MS);
    expect(lone.ms).toBeLessThan(LIMIT_MS);
    expect(flags.ms).toBeLessThan(LIMIT_MS);
  });
});

describe("sonar-three: an Authorization header is a secret with a scheme or a long value (#363)", () => {
  test("the scheme and its credential, or one long unbroken value, are matched; the word in a sentence is not", () => {
    const cases: Array<[string, string[], string]> = [
      ["Authorization: Bearer abc.def", [AUTHORIZATION], "[redacted]"],
      [
        "Proxy-Authorization: Basic dXNlcjpwYXNz",
        [AUTHORIZATION, "credencial Basic"],
        "[redacted]",
      ],
      ['Authorization: "Token abcdef"', [AUTHORIZATION], '[redacted]"'],
      ['Authorization\\":\\"NTLM abc\\"', [AUTHORIZATION], '[redacted]\\"'],
      ["authorization=aaaaaaaaaaaaaaaaaaaa", [AUTHORIZATION], "[redacted]"],
      ["Authorization: Bot x\ny", [AUTHORIZATION], "[redacted]\ny"],
      ["Authorization: Digest a=b, c=d", [AUTHORIZATION], "[redacted]"],
      ["Authorization : Negotiate YIIx", [AUTHORIZATION], "[redacted]"],
      ["authorization=aaaaaaaaaaaaaaaaaaa", [], "authorization=aaaaaaaaaaaaaaaaaaa"],
      ["the Authorization header is", [], "the Authorization header is"],
    ];
    expect(cases.map(([text]) => scanner.scan(text))).toEqual(cases.map(([, kinds]) => kinds));
    expect(cases.map(([text]) => scanner.redact(text))).toEqual(cases.map(([, , clean]) => clean));
  });

  test("a very long value is read in linear time", () => {
    const value = timed(() => scanner.redact(`Authorization: ${"a".repeat(20_000)}`));
    expect(value.value).toBe("[redacted]");
    expect(value.ms).toBeLessThan(LIMIT_MS);
  });
});
