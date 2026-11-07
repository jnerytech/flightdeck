import { describe, expect, test } from "bun:test";
import { SECRET_KINDS } from "@flightdeck/protocol";
import { refusalText as assistantText } from "../src/components/assistant/refusal-text.ts";
import { translateError } from "../src/i18n/errors.ts";
import { type Key, translator } from "../src/i18n/index.ts";

/**
 * Issue #714: every kind the scanner can name has a text in each language, and every screen that
 * shows what was found uses it: the refusals of a persona, a PR, a merge message, a snippet and
 * the assistant. A kind the app does not know stays as the host sent it.
 */
const EN = translator("en");
const PT = translator("pt-BR");

const NAMES: Record<string, [string, string]> = {
  github_token: ["GitHub token", "token do GitHub"],
  sk_key: ["sk- key", "chave sk-"],
  aws_key: ["AWS key", "chave da AWS"],
  private_key: ["private key", "chave privada"],
  bearer_token: ["Bearer token", "token Bearer"],
  slack_token: ["Slack token", "token do Slack"],
  password_line: ["password in a line", "senha na linha"],
  url_credential: ["credential in a URL", "credencial em URL"],
  password_option: ["password in an option", "senha em opção"],
  curl_password: ["curl password", "senha do curl"],
  authorization_header: ["authorization header", "cabeçalho de autorização"],
  cookie: ["cookie", "cookie"],
  basic_credential: ["Basic credential", "credencial Basic"],
  jwt: ["JWT", "JWT"],
  service_key: ["service key", "chave de serviço"],
  webhook: ["webhook", "webhook"],
  signed_url: ["signed URL", "URL assinada"],
  url_token: ["token in a URL", "token em URL"],
  vault_value: ["vault value", "valor do cofre"],
};

describe("secret-kinds-text: every kind has a name in both languages (#714)", () => {
  test("the list of kinds and the names in the two dictionaries agree", () => {
    const named = (t: typeof EN, at: 0 | 1) =>
      SECRET_KINDS.map((kind) => [kind, t(`secretKind.${kind}` as Key)]).filter(
        ([kind, text]) => text !== NAMES[kind as string]?.[at],
      );
    expect([[...SECRET_KINDS].sort(), named(EN, 0), named(PT, 1)]).toEqual([
      Object.keys(NAMES).sort(),
      [],
      [],
    ]);
  });
});

describe("secret-kinds-text: the screens name the kinds from the dictionary (#714)", () => {
  const why = (reason: string, key: string, kinds: string) => ({
    reason,
    params: { [key]: kinds },
  });

  test("a persona, a PR description and title, and a merge message", () => {
    const kinds = "github_token, password_line";
    const title = (t: typeof EN, reason: string, key: string) =>
      translateError("bad_request", "", t, why(reason, key, kinds)).title;
    expect([
      title(EN, "persona_has_secret", "kinds"),
      title(PT, "persona_has_secret", "kinds"),
      title(EN, "pr_secret", "found"),
      title(EN, "pr_title_secret", "found"),
      title(PT, "merge_message_secret", "found"),
    ]).toEqual([
      "The persona has a secret (GitHub token, password in a line): instructions carry no secrets.",
      "A persona tem um segredo (token do GitHub, senha na linha): instruções não levam segredo.",
      "The description looks like it has a secret (GitHub token, password in a line): take it out before opening the PR.",
      "The title looks like it has a secret (GitHub token, password in a line): take it out before opening the PR.",
      "A mensagem do merge parece ter um segredo (token do GitHub, senha na linha): tire-o antes de mesclar.",
    ]);
  });

  test("a snippet and the assistant", () => {
    expect([
      translateError("snippet_secret", "", EN, why("secret", "kinds", "aws_key")).title,
      assistantText(EN, { reason: "assistant_secret_found", params: { labels: "jwt, cookie" } }),
    ]).toEqual([
      "The snippet has a secret (AWS key): keep it in the vault, or turn it into an action.",
      "Nothing was sent: the text looks like it holds a secret (JWT, cookie). Remove it and try again.",
    ]);
  });

  test("a kind this app does not know stays as the host sent it", () => {
    expect(
      translateError("bad_request", "", EN, why("persona_has_secret", "kinds", "aws_key, new_kind"))
        .title,
    ).toBe("The persona has a secret (AWS key, new_kind): instructions carry no secrets.");
  });
});
