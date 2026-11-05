import { describe, expect, test } from "bun:test";
import { SecretScanner } from "../src/snippets.ts";

const SECRETS = [
  "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "sk-abcdefghijklmnopqrstuvwx",
  "AKIAABCDEFGHIJKLMNOP",
  "xoxb-1234567890-abcdefghij",
  "Bearer abcdefghijklmnopqrstuvwxyz012345",
  "password=hunter2hunter2",
  "token: s3cr3t-value",
  "https://user:pa55word@example.com/path",
  "-----BEGIN OPENSSH PRIVATE KEY-----",
];

describe("redact: a scanner that removes what it finds", () => {
  test("every kind of secret it can scan for is gone from the text", () => {
    const scanner = new SecretScanner();
    for (const secret of SECRETS) {
      const line = `connecting with ${secret} to the host`;
      expect(scanner.scan(line).length).toBeGreaterThan(0);
      const clean = scanner.redact(line);
      expect(clean).toContain("[redacted]");
      expect(scanner.scan(clean)).toEqual([]);
      expect(clean).not.toContain(secret.replace(/^(password|token)\s*[=:]\s*/i, ""));
      expect(clean.startsWith("connecting with ")).toBe(true);
      expect(
        clean.endsWith(" to the host") || secret.includes("password") || secret.includes("token"),
      ).toBe(true);
    }
  });

  test("text with no secret is returned as it is, and a {{variable}} is not a secret", () => {
    const scanner = new SecretScanner();
    expect(scanner.redact("host alfa went offline")).toBe("host alfa went offline");
    expect(scanner.redact("password={{password}}")).toBe("password={{password}}");
  });

  test("several secrets in one line, and the same one twice, all go", () => {
    const scanner = new SecretScanner();
    const line = `a ${SECRETS[0]} b ${SECRETS[1]} c ${SECRETS[0]}`;
    const clean = scanner.redact(line);
    expect(clean.match(/\[redacted\]/g)).toHaveLength(3);
    expect(clean).not.toContain("ghp_");
    expect(clean).not.toContain("sk-");
  });

  test("a vault value goes too, once it is long enough to be told from ordinary text", () => {
    const scanner = new SecretScanner(() => ["correct-horse-battery", "abc"]);
    expect(scanner.redact("typed correct-horse-battery then abc")).toBe(
      "typed [redacted] then abc",
    );
  });

  test("a pairing link's token and the app's own secrets are covered by the shapes above", () => {
    const scanner = new SecretScanner();
    const link = "flightdeck://pair?url=ws://100.1.2.3:7420&token=0123456789abcdef0123456789abcdef";
    const clean = scanner.redact(`opened ${link}`);
    expect(clean).not.toContain("0123456789abcdef0123456789abcdef");
  });
});
