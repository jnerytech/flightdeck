import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { signForTest, TEST_PUBLIC_KEY } from "../../../scripts/test/minisign.ts";
import { verifyMinisign } from "../src/updates/signature.ts";

const FIXTURES = resolve(import.meta.dir, "fixtures/release");
const fixture = (name: string) => readFileSync(resolve(FIXTURES, name));
const TAURI_PUB = fixture("tauri-signer.pub").toString().trim();
const SAMPLE = fixture("sample.bin");
const SAMPLE_SIG = fixture("sample.bin.sig").toString().trim();

/** The reason `verifyMinisign` gives, or "ok". */
function check(data: Uint8Array, signature: string, publicKey: string): string {
  try {
    verifyMinisign(data, signature, publicKey);
    return "ok";
  } catch (error) {
    return (error as Error).message;
  }
}

/** The base64 minisign text with one of its lines replaced. */
function withLine(signature: string, index: number, line: string): string {
  const lines = Buffer.from(signature, "base64").toString().split("\n");
  lines[index] = line;
  return Buffer.from(lines.join("\n")).toString("base64");
}

describe("assinatura", () => {
  test("aceita o arquivo assinado pelo tauri signer, no formato que ele gera", () => {
    expect(check(SAMPLE, SAMPLE_SIG, TAURI_PUB)).toBe("ok");
  });

  test("aceita o assinado pela chave de teste, com e sem pré-hash, e a chave em texto puro", () => {
    const data = new TextEncoder().encode("binário do daemon");
    expect(check(data, signForTest(data), TEST_PUBLIC_KEY)).toBe("ok");
    expect(check(data, signForTest(data, { prehash: false }), TEST_PUBLIC_KEY)).toBe("ok");
    const plainKey = Buffer.from(TEST_PUBLIC_KEY, "base64").toString();
    expect(check(data, signForTest(data), plainKey)).toBe("ok");
  });

  test("recusa arquivo alterado, assinatura de outra chave e comentário confiável trocado", () => {
    const altered = Buffer.from(SAMPLE);
    altered[0] = (altered[0] as number) ^ 1;
    expect(check(altered, SAMPLE_SIG, TAURI_PUB)).toBe("a assinatura não confere com o arquivo");
    expect(check(SAMPLE, SAMPLE_SIG, TEST_PUBLIC_KEY)).toBe(
      "a assinatura é de outra chave, não da chave do Flightdeck",
    );
    const tampered = withLine(SAMPLE_SIG, 2, "trusted comment: timestamp:1\tfile:outro.bin");
    expect(check(SAMPLE, tampered, TAURI_PUB)).toBe(
      "o comentário confiável da assinatura foi alterado",
    );
  });

  test("recusa formato inválido de assinatura e de chave", () => {
    const data = new TextEncoder().encode("x");
    expect(check(data, "não é base64 de minisign", TEST_PUBLIC_KEY)).toBe(
      "formato de assinatura inválido",
    );
    expect(check(data, withLine(signForTest(data), 1, "QUJD"), TEST_PUBLIC_KEY)).toBe(
      "formato de assinatura inválido",
    );
    expect(check(data, signForTest(data), "lixo")).toBe("formato de chave pública inválido");
  });

  test("as chaves de teste não são a chave pública do produto", () => {
    const product = readFileSync(
      resolve(import.meta.dir, "../../../release/flightdeck.pub"),
      "utf8",
    );
    for (const key of [TEST_PUBLIC_KEY, TAURI_PUB]) {
      expect(product.trim()).not.toBe(key);
      expect(product).not.toContain(Buffer.from(key, "base64").toString().split("\n")[1] as string);
    }
  });
});
