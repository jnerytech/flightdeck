import { expect } from "bun:test";
import type { SecretMeta } from "../../src/features/vault/vault.ts";
import type { AppStore } from "../../src/lib/app-store.ts";

/** Adds a secret through the store and fails the test, by assertion, when the vault refused it. */
export async function addedSecret(
  store: AppStore,
  input: Parameters<AppStore["secrets"]["add"]>[0],
): Promise<SecretMeta> {
  const meta = await store.secrets.add(input);
  expect(meta).not.toBeNull();
  return meta as SecretMeta;
}
