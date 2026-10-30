import { describe, expect, test } from "bun:test";
import { type MaskedSecret, maskOutput } from "../src/actions/mask.ts";

const TOKEN: MaskedSecret = { name: "deploy-token", value: "ghp_AbC123xyz-SEGREDO" };
const KEY: MaskedSecret = {
  name: "chave-ssh",
  value:
    "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU\nQyNTUxOQAAACD1x2cY\n-----END OPENSSH PRIVATE KEY-----",
};
const mask = (text: string, ...secrets: MaskedSecret[]) => maskOutput(text, secrets);
const b64 = (text: string) => Buffer.from(text).toString("base64");
const hex = (text: string) => Buffer.from(text).toString("hex");

describe("mascara", () => {
  test("o valor literal vira •••(nome), todas as vezes", () => {
    expect(mask(`token=${TOKEN.value}; de novo ${TOKEN.value}.`, TOKEN)).toBe(
      "token=•••(deploy-token); de novo •••(deploy-token).",
    );
    expect(mask("nada a esconder aqui", TOKEN)).toBe("nada a esconder aqui");
    expect(mask("", TOKEN)).toBe("");
  });

  test("vários segredos, cada um com o seu nome; o mais comprido vence um que o contém", () => {
    const short: MaskedSecret = { name: "curto", value: "abcdef" };
    const long: MaskedSecret = { name: "longo", value: "abcdef-123456" };
    expect(mask("a abcdef-123456 b abcdef c", short, long)).toBe("a •••(longo) b •••(curto) c");
    expect(mask(`${TOKEN.value} ${short.value}`, TOKEN, short)).toBe(
      "•••(deploy-token) •••(curto)",
    );
  });

  test("um valor de várias linhas é mascarado inteiro e linha a linha", () => {
    expect(mask(`antes\n${KEY.value}\ndepois`, KEY)).toBe("antes\n•••(chave-ssh)\ndepois");
    const lines = KEY.value.split("\n");
    const piece = `log: ${lines[1]} e ${lines[2]}`;
    expect(mask(piece, KEY)).toBe("log: •••(chave-ssh) e •••(chave-ssh)");
    // Short lines of a value are not hidden: they would shred ordinary output.
    expect(mask("--", { name: "x", value: "a\nb\nlonga-o-bastante" })).toBe("--");
  });

  test("em base64, base64url, URL-encode e hex também", () => {
    const value = "p@ss word/+=é?&";
    const secret: MaskedSecret = { name: "senha", value };
    expect(mask(`b64:${b64(value)}`, secret)).toBe("b64:•••(senha)");
    expect(mask(`b64url:${b64(value).replaceAll("+", "-").replaceAll("/", "_")}`, secret)).toBe(
      "b64url:•••(senha)",
    );
    expect(
      mask(
        `b64url:${b64(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`,
        secret,
      ),
    ).toBe("b64url:•••(senha)");
    expect(mask(`url:${encodeURIComponent(value)}`, secret)).toBe("url:•••(senha)");
    expect(mask(`url:${encodeURIComponent(value).toLowerCase()}`, secret)).toBe("url:•••(senha)");
    expect(mask(`form:${encodeURIComponent(value).replaceAll("%20", "+")}`, secret)).toBe(
      "form:•••(senha)",
    );
    expect(mask(`hex:${hex(value)} HEX:${hex(value).toUpperCase()}`, secret)).toBe(
      "hex:•••(senha) HEX:•••(senha)",
    );
    expect(mask(`json:${JSON.stringify({ k: value })}`, secret)).toBe('json:{"k":"•••(senha)"}');
    expect(mask(`json:${JSON.stringify({ k: KEY.value })}`, KEY)).toBe(
      'json:{"k":"•••(chave-ssh)"}',
    );
  });

  test("caracteres especiais não quebram nada, e um valor vazio é ignorado", () => {
    const tricky: MaskedSecret = { name: "regex", value: "a.b*c(d)[e]|f$^g\\h+" };
    expect(mask(`x ${tricky.value} y`, tricky)).toBe("x •••(regex) y");
    expect(mask("qualquer coisa", { name: "vazio", value: "" })).toBe("qualquer coisa");
    expect(maskOutput("x", [])).toBe("x");
  });

  test("o nome de um segredo no texto mascarado não é mascarado de novo por outro valor", () => {
    const a: MaskedSecret = { name: "token", value: "tok-aaaaaa" };
    const b: MaskedSecret = { name: "outro", value: "token" };
    expect(mask("tok-aaaaaa", a, b)).toBe("•••(token)");
  });
});
