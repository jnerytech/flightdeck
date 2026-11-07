import { describe, expect, test } from "bun:test";
import { SECRET_KINDS, SecretScanner } from "../src/snippets.ts";

/**
 * Issue #714: the scanner names what it finds with stable kinds, never with a label in one
 * language. The app names each kind from its dictionaries.
 */
const KINDS = [
  "github_token",
  "sk_key",
  "aws_key",
  "private_key",
  "bearer_token",
  "slack_token",
  "password_line",
  "url_credential",
  "password_option",
  "curl_password",
  "authorization_header",
  "cookie",
  "basic_credential",
  "jwt",
  "service_key",
  "webhook",
  "signed_url",
  "url_token",
  "vault_value",
];

/** One text per kind, the kind among what the scanner finds in it. */
const SAMPLES: Record<string, string> = {
  github_token: "curl -H 'X: ghp_0123456789abcdef0123456789abcdef0123'",
  sk_key: "export OPENAI_API_KEY=sk-proj-0123456789abcdef0123456789abcdef",
  aws_key: "aws configure set key AKIA0123456789ABCDEF",
  private_key: "-----BEGIN RSA PRIVATE KEY-----",
  bearer_token: "echo Bearer abcdefghijklmnop0123456789",
  slack_token: "curl -d token=xoxb-0123456789-abcdefghij https://slack.com/api",
  password_line: "mysql -u root password=hunter2hunter2",
  url_credential: "psql postgres://admin:s3cr3tpass@db.example.com/app",
  password_option: "deploy --password hunter2hunter2",
  curl_password: "curl -u admin:s3cr3tpass https://api.example.com",
  authorization_header: "Authorization: Digest 0123456789abcdef0123456789abcdef",
  cookie: "Cookie: session=abcdef",
  basic_credential: "echo Basic dXNlcjpwYXNzd29yZA==",
  jwt: "eyJhbGciOiJI.eyJzdWIiOiIx.abcdefgh",
  service_key: "key AIza0123456789abcdefghijklmnopqrstuvwxyz",
  webhook: "https://hooks.slack.com/services/T000/B000/XXXXXXXX",
  signed_url: "https://files.example.com/a.png?signature=abcdef123456",
  url_token: "git clone https://abcdefghijklmnopqrstuvwxyz@host.example/repo",
};

describe("secret-kinds: the scanner names what it finds with stable kinds (#714)", () => {
  test("the kinds are these, each an identifier and none a label in a language", () => {
    expect([[...SECRET_KINDS], SECRET_KINDS.every((kind) => /^[a-z][a-z_]*$/.test(kind))]).toEqual([
      KINDS,
      true,
    ]);
  });

  test("a text of each kind is found as that kind", () => {
    const scanner = new SecretScanner();
    const missed = Object.entries(SAMPLES)
      .filter(([kind, text]) => !scanner.scan(text).includes(kind as never))
      .map(([kind]) => kind);
    expect(missed).toEqual([]);
  });

  test("a vault value is its own kind, and nothing found is outside the list", () => {
    const scanner = new SecretScanner(() => ["correct-horse-battery"]);
    const all = [...Object.values(SAMPLES), "echo correct-horse-battery"].flatMap((text) =>
      scanner.scan(text),
    );
    expect([
      scanner.scan("echo correct-horse-battery"),
      all.filter((kind) => !(SECRET_KINDS as readonly string[]).includes(kind)),
    ]).toEqual([["vault_value"], []]);
  });
});
