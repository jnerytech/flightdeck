import { useState } from "react";
import { useT } from "@/i18n/context";
import type { AppState, AppStore } from "@/lib/app-store";
import type { UsageEntry, UsageFilter } from "@/lib/vault-usage";

const REQUESTERS = ["you", "claude", "automation", "workflow", "unknown"] as const;
type Requester = (typeof REQUESTERS)[number];
const isRequester = (value: string): value is Requester => REQUESTERS.some((r) => r === value);

const SELECT = "h-9 rounded-md border bg-transparent px-2";

/** Phase 16: what was asked of the vault, newest first; a line never holds a value. */
export function UsageLog(props: { store: AppStore; state: AppState }) {
  const t = useT();
  const { store, state } = props;
  const [secretId, setSecretId] = useState("");
  const [requester, setRequester] = useState("");
  const filter: UsageFilter = {
    ...(secretId && { secretId }),
    ...(requester && { requester }),
  };
  // Read again on each render: `state.vaultUsage` changes whenever a line arrives.
  const entries = store.usage.list(filter);
  const secretName = (id: string) => state.secrets.find((s) => s.id === id)?.name ?? id;
  const hostName = (id: string) => state.hosts.find((h) => h.id === id)?.name ?? id;
  const who = (entry: UsageEntry) =>
    t(`vault.requester.${isRequester(entry.requester) ? entry.requester : "unknown"}`);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("vault.filterSecret")}
          <select className={SELECT} value={secretId} onChange={(e) => setSecretId(e.target.value)}>
            <option value="">{t("vault.all")}</option>
            {state.secrets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("vault.filterRequester")}
          <select
            className={SELECT}
            value={requester}
            onChange={(e) => setRequester(e.target.value)}
          >
            <option value="">{t("vault.all")}</option>
            {REQUESTERS.map((r) => (
              <option key={r} value={r}>
                {t(`vault.requester.${r}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {entries.length === 0 ? (
        <p className="text-muted-foreground">{t("vault.usageEmpty")}</p>
      ) : (
        <ul aria-label={t("vault.usageList")} className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={`${entry.at}-${entry.secretId}-${entry.kind}-${entry.detail}`}
              className="rounded-lg border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{secretName(entry.secretId)}</span>
                <span>{hostName(entry.hostId)}</span>
                <span>{entry.purpose}</span>
                <span>{who(entry)}</span>
                <span className="text-muted-foreground">{new Date(entry.at).toLocaleString()}</span>
              </div>
              <p className="text-muted-foreground">
                {t(`vault.result.${entry.kind}`)}
                {entry.detail && `: ${entry.detail}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
