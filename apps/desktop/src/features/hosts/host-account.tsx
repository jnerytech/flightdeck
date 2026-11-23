import { useEffect, useState } from "react";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { useStoreSlice } from "../../lib/use-store.ts";
import { isAccountPending } from "../account/index.ts";
import { AccountCard } from "../account/ui.ts";

/** After a refresh the button stays off this long: the host refuses a sooner one anyway. */
const COOLDOWN_MS = 30_000;

/** A host that has not said anything after this long gets an error and a Try again, not a spinner. */
const LOADING_MS = 15_000;

const KEYS = ["account"] as const;

/** The account card of one host, wired to the app: it watches the host's account while on screen. */
export function HostAccount(
  props: Readonly<{ store: AppStore; host: HostView; cooldownMs?: number; loadingMs?: number }>,
) {
  const { store, host } = props;
  const state = useStoreSlice(store, KEYS).account[host.id];
  const [busy, setBusy] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [waited, setWaited] = useState(false);
  const online = host.status === "online";
  const pending = online && isAccountPending(state);
  useEffect(() => (online ? store.account.watch(host.id) : undefined), [store, host.id, online]);
  useEffect(() => {
    setWaited(false);
    if (!pending) return;
    const timer = setTimeout(() => setWaited(true), props.loadingMs ?? LOADING_MS);
    return () => clearTimeout(timer);
  }, [pending, props.loadingMs]);
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
      refreshing={busy}
      cooling={cooling}
      timedOut={waited}
      copied={copied}
      onRefresh={() => {
        setBusy(true);
        void store.account.refresh(host.id).then(() => {
          setBusy(false);
          setCooling(true);
        });
      }}
      onCopy={() => void store.system.copyText(state?.loginCommand ?? "").then(setCopied)}
      onTerminal={() => void store.terminals.open(host.id)}
    />
  );
}
