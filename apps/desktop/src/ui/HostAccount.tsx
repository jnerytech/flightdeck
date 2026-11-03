import { useEffect, useState } from "react";
import type { AppStore, HostView } from "../lib/app-store.ts";
import { useStoreSlice } from "../lib/use-store.ts";
import { AccountCard } from "./AccountCard.tsx";

/** After a refresh the button stays off this long: the host refuses a sooner one anyway. */
const COOLDOWN_MS = 30_000;

const KEYS = ["account"] as const;

/** The account card of one host, wired to the app: it watches the host's account while on screen. */
export function HostAccount(props: { store: AppStore; host: HostView; cooldownMs?: number }) {
  const { store, host } = props;
  const state = useStoreSlice(store, KEYS).account[host.id];
  const [busy, setBusy] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [copied, setCopied] = useState(false);
  const online = host.status === "online";
  useEffect(() => (online ? store.watchAccount(host.id) : undefined), [store, host.id, online]);
  useEffect(() => {
    if (!cooling) return;
    const timer = setTimeout(() => setCooling(false), props.cooldownMs ?? COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [cooling, props.cooldownMs]);
  return (
    <AccountCard
      hostName={host.name}
      online={online}
      state={online ? state : undefined}
      now={store.now()}
      formatTime={(iso) => store.formatTime(iso)}
      refreshing={busy || cooling}
      copied={copied}
      onRefresh={() => {
        setBusy(true);
        void store.refreshAccount(host.id).then(() => {
          setBusy(false);
          setCooling(true);
        });
      }}
      onCopy={() => void store.copyText(state?.loginCommand ?? "").then(setCopied)}
      onTerminal={() => void store.openTerminal(host.id)}
    />
  );
}
