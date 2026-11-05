import { describe, expect, test } from "bun:test";
import { SecretScanner } from "../src/snippets.ts";

/** Each case: a line a log could carry, and the fake value that must not survive it. */
const FAKE = "FAKEVALUE0123456789abcdef";
const CASES: Array<[string, string, string]> = [
  ["a JSON key", `{"token":"${FAKE}"}`, FAKE],
  ["a JSON password", `{"password":"${FAKE}"}`, FAKE],
  ["a JSON key with a prefix", `{"access_token":"${FAKE}"}`, FAKE],
  ["a camelCase key", `{"clientSecret":"${FAKE}"}`, FAKE],
  ["a JSON key inside a JSON string", `{"m":"{\\"token\\":\\"${FAKE}\\"}"}`, FAKE],
  ["a JSON key with a space after the colon", `{"apiKey": "${FAKE}"}`, FAKE],
  ["an environment variable", `DB_PASSWORD=${FAKE}`, FAKE],
  ["a variable with a prefix and a suffix", `MY_SECRET_KEY=${FAKE}`, FAKE],
  ["a refresh token", `refresh_token=${FAKE}`, FAKE],
  ["a camelCase token", `authToken=${FAKE}`, FAKE],
  ["a password flag", `run --password ${FAKE} now`, FAKE],
  ["a token flag with =", `run --token=${FAKE} now`, FAKE],
  ["curl with -u", `curl -s -u admin:${FAKE} https://example.test/x`, FAKE],
  ["a Basic header", `Authorization: Basic ${FAKE}`, FAKE],
  ["a token header", `Authorization: token ${FAKE}`, FAKE],
  ["a short Bearer header", `Authorization: Bearer ${"a1b2c3"}`, "a1b2c3"],
  ["a quoted header in JSON", `{"Authorization":"Bearer ${FAKE}"}`, FAKE],
  ["a cookie", `Cookie: sid=${FAKE}; theme=dark`, FAKE],
  ["a set-cookie", `Set-Cookie: sid=${FAKE}; Path=/`, FAKE],
  [
    "a JWT",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJGQUtFVkFMVUUifQ.c2lnbmF0dXJlRkFLRVZBTFVF",
    "eyJzdWIiOiJGQUtFVkFMVUUifQ",
  ],
  ["a Google key", `key AIza${"B".repeat(35)}`, "BBBBBBBBBB"],
  ["a Stripe key", `sk_live_${"c".repeat(24)}`, "cccccccccccc"],
  ["an npm token", `npm_${"d".repeat(36)}`, "dddddddddddd"],
  ["a GitLab token", `glpat-${"e".repeat(20)}`, "eeeeeeeeee"],
  ["a Slack webhook", `https://hooks.slack.com/services/T0FAKE00/B0FAKE00/${FAKE}`, FAKE],
  ["a Discord webhook", `https://discord.com/api/webhooks/123456789/${FAKE}`, FAKE],
  ["a signed URL", `GET https://files.example.test/a?sig=${FAKE}&x=1`, FAKE],
  ["a token as the user of a URL", `https://${"f".repeat(30)}@example.test/repo.git`, "ffffffffff"],
  ["a bare password after a quote and an equals", `login failed password='${FAKE}'`, FAKE],
];

const PEM = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwFAKEBODY1",
  "FAKEBODYLINE2FAKEBODYLINE2FAKEBODYLINE2FAKEBODYLINE2FAKEBODYLINE2==",
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");

describe("redact-lacunas: the shapes the review found going through (issue #255)", () => {
  const scanner = new SecretScanner();
  for (const [name, line, secret] of CASES) {
    test(`${name} is redacted, and the rest of the line stays`, () => {
      const clean = scanner.redact(`before ${line} after`);
      expect(clean).not.toContain(secret);
      expect(clean).toContain("[redacted]");
      expect(clean.startsWith("before ")).toBe(true);
      expect(scanner.scan(line).length).toBeGreaterThan(0);
      // Redacting twice changes nothing more.
      expect(scanner.redact(clean)).toBe(clean);
    });
  }

  test("a private key goes whole: the body and the END line too", () => {
    const clean = scanner.redact(`ssh failed: ${PEM}\nnext line`);
    expect(clean).not.toContain("FAKEBODYLINE2");
    expect(clean).not.toContain("b3BlbnNzaC1rZXk");
    expect(clean).not.toContain("END OPENSSH");
    expect(clean).toBe("ssh failed: [redacted]\nnext line");
  });

  test("a key cut before its END line (a capped message) is redacted to the end", () => {
    const clean = scanner.redact(`${PEM.split("\n").slice(0, 3).join("\n")}`);
    expect(clean).not.toContain("FAKEBODYLINE2");
    expect(clean).toBe("[redacted]");
  });

  test("a log never keeps a hit because it holds {{ }}, a snippet scan still does", () => {
    expect(scanner.redact("password=hunter2hunter2{{x}}", false)).not.toContain("hunter2");
    expect(scanner.redact("password={{secret_value}}")).toBe("password={{secret_value}}");
    expect(scanner.redact("password=hunter2hunter2{{x}}")).toContain("hunter2");
  });

  test("ordinary text is left alone", () => {
    const text = [
      "bypass=false",
      "docker run -u 1000:1000 image",
      "compass: north",
      "the token was refreshed",
      "pass: 3 tests",
      "Authorization header missing",
      "https://user@example.test/path",
      "Bearer authentication",
    ].join("\n");
    expect(scanner.redact(text, false)).toBe(text);
  });
});
