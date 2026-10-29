/**
 * Signs like `tauri signer sign`, with the test key in apps/daemon/test/fixtures/release/
 * (never the project's): minisign over the BLAKE2b-512 of the file ("ED"), or over the file itself
 * ("Ed"), with a trusted comment and its global signature, the whole text in base64.
 */
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES = resolve(import.meta.dir, "../../apps/daemon/test/fixtures/release");

/** The test public key, in the format `tauri signer generate` writes (`.pub`). */
export const TEST_PUBLIC_KEY = readFileSync(resolve(FIXTURES, "test-signing.pub"), "utf8").trim();

const privateKey = createPrivateKey(readFileSync(resolve(FIXTURES, "test-signing.key.pem")));
const keyId = Buffer.from(
  Buffer.from(TEST_PUBLIC_KEY, "base64").toString().split("\n")[1] as string,
  "base64",
).subarray(2, 10);

export function signForTest(
  data: Uint8Array,
  opts: { prehash?: boolean; trusted?: string } = {},
): string {
  const prehash = opts.prehash ?? true;
  const signed = prehash ? createHash("blake2b512").update(data).digest() : data;
  const signature = sign(null, signed, privateKey);
  const trusted = opts.trusted ?? `timestamp:${Math.floor(Date.now() / 1000)}\tfile:teste`;
  const global = sign(null, Buffer.concat([signature, Buffer.from(trusted)]), privateKey);
  const text = [
    "untrusted comment: signature from tauri secret key",
    Buffer.concat([Buffer.from(prehash ? "ED" : "Ed"), keyId, signature]).toString("base64"),
    `trusted comment: ${trusted}`,
    global.toString("base64"),
    "",
  ].join("\n");
  return Buffer.from(text).toString("base64");
}
