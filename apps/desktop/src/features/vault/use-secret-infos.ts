import { inSequence } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import type { AppStore } from "../../lib/app-store.ts";
import type { SecretInfo } from "./domain/vault-types.ts";
import type { SecretMeta } from "./vault.ts";

/** What describes each secret on its row, read from the vault; forgotten when the screen is left. */
export function useSecretInfos(
  store: AppStore,
  secrets: readonly SecretMeta[],
): Record<string, SecretInfo> {
  const [infos, setInfos] = useState<Record<string, SecretInfo>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, SecretInfo> = {};
      // The vault reads a value only for a secret it has not described yet, and only for a type that has something to show.
      await inSequence(secrets, async (secret) => {
        // A page that is gone (or a newer list) reads nothing more, so the vault is not refilled after it forgot.
        if (!alive) return;
        try {
          next[secret.id] = await store.vault.info(secret);
        } catch {
          // A secret the vault cannot read shows no details; the other rows keep theirs.
        }
      });
      if (alive) setInfos(next);
    })();
    return () => {
      alive = false;
    };
  }, [store, secrets]);

  // Leaving the screen forgets the derived details; they come back with the next visit.
  useEffect(() => () => store.vault.forgetInfos(), [store]);

  return infos;
}
