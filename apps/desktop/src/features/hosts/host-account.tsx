import { useEffect, useState } from "react";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { useStoreSlice } from "../../lib/use-store.ts";
import { isAccountPending } from "../account/index.ts";
import { AccountCard } from "../account/ui.ts";

/** After a refresh the button stays off this long: the host refuses a sooner one anyway. */
const COOLDOWN_MS = 30_000;

/** "Command copied" (or the failure) stays this long, then the button is as it was. */
const COPIED_MS = 4_000;

/** A host that has not said anything after this long gets an error and a Try again, not a spinner. */
const LOADING_MS = 15_000;

const KEYS = ["account"] as const;

/** The account card of one host, wired to the app: it watches the host's account while on screen. */
export function HostAccount(
  props: Readonly<{
    store: AppStore;
    host: HostView;
    cooldownMs?: number;
    loadingMs?: number;
    copiedMs?: number;
  }>,
) {
  const { store, host } = props;
  const state = useStoreSlice(store, KEYS).account[host.id];
  const [busy, setBusy] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [copy, setCopy] = useState<"ok" | "failed" | null>(null);
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
  useEffect(() => {
    if (copy === null) return;
    // A failure tells the person to copy by hand: it stays longer than a confirmation.
    const ms = (props.copiedMs ?? COPIED_MS) * (copy === "failed" ? 3 : 1);
    const timer = setTimeout(() => setCopy(null), ms);
    return () => clearTimeout(timer);
  }, [copy, props.copiedMs]);
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
      copied={copy === "ok"}
      copyFailed={copy === "failed"}
      onRefresh={() => {
        setBusy(true);
        void store.account.refresh(host.id).then(() => {
          setBusy(false);
          setCooling(true);
        });
      }}
      onCopy={() => {
        // Back to nothing first: a second press with the same result restarts the timer.
        setCopy(null);
        void store.system
          .copyText(state?.loginCommand ?? "")
          .then((ok) => setCopy(ok ? "ok" : "failed"));
      }}
      onTerminal={() => void store.terminals.open(host.id)}
    />
  );
}
