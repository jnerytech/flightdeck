import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Page } from "@/components/layout/page";
import { EmptyState } from "@/components/layout/states";
import { useT } from "@/i18n/context";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { SecretMeta } from "../lib/vault.ts";
import { describeSecret, type SecretInfo } from "../lib/vault-types.ts";

/** What describes a secret on its row, without revealing it. */
function infoText(info: SecretInfo, fingerprint: (value: string) => string): string {
  if (info.fingerprint) return fingerprint(info.fingerprint);
  return info.hint ?? info.names?.join(", ") ?? "";
}

function SecretRow(props: { secret: SecretMeta; info: SecretInfo }) {
  const t = useT();
  const { secret, info } = props;
  const detail = infoText(info, (value) => t("vault.fingerprint", { value }));
  return (
    <li className="flex flex-col gap-1 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{secret.name}</span>
        <span className="text-muted-foreground text-sm">{t(`vault.type.${secret.type}`)}</span>
        {secret.tags.map((tag) => (
          <span key={tag} className="rounded bg-muted px-1.5 text-xs">
            {tag}
          </span>
        ))}
      </div>
      {detail && <p className="font-mono text-muted-foreground text-sm">{detail}</p>}
    </li>
  );
}

/** Phase 16: the vault's screen. */
export function VaultPage(props: {
  store: AppStore;
  state: AppState;
  /** How long a revealed value stays on screen. */
  revealMs?: number;
  /** How long a copied value stays on the clipboard. */
  clearMs?: number;
}) {
  const t = useT();
  const { store, state } = props;
  const [infos, setInfos] = useState<Record<string, SecretInfo>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, SecretInfo> = {};
      for (const secret of state.secrets) {
        const value = await store.vault.value(secret.id);
        next[secret.id] = value === null ? {} : await describeSecret(secret.type, value);
      }
      if (alive) setInfos(next);
    })();
    return () => {
      alive = false;
    };
  }, [store, state.secrets]);

  return (
    <Page title={t("vault.title")} subtitle={t("vault.subtitle")}>
      {state.secrets.length === 0 ? (
        <EmptyState icon={KeyRound} title={t("vault.empty")} />
      ) : (
        <ul aria-label={t("vault.list")} className="flex flex-col gap-2">
          {state.secrets.map((secret) => (
            <SecretRow key={secret.id} secret={secret} info={infos[secret.id] ?? {}} />
          ))}
        </ul>
      )}
    </Page>
  );
}
