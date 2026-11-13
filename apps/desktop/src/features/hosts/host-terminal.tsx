import type { TerminalInfo } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { ActionButton, ConfirmDialog } from "@/shared/feedback/index.ts";
import { Panel } from "@/shared/layout/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { RequestError } from "./host-connection.ts";

/** How often the list of live terminals is asked again. */
const LIST_REFRESH_MS = 1000;

/**
 * The host's embedded terminals (phase 14): a new one, the live ones, and turning them on (which
 * asks, since a terminal is a full shell on the host) or off (which ends the live ones).
 */
export function HostTerminal(props: Readonly<{ store: AppStore; host: HostView }>) {
  const { store, host } = props;
  const t = useT();
  const info = host.hostInfo;
  const online = host.status === "online";
  const enabled = hasFeature(info?.features, "terminal", false);
  // null until a read worked: a failed read keeps the last list, and says so only if there is none (#2587).
  const [live, setLive] = useState<TerminalInfo[] | null>(null);
  /** A read failed: with no list yet, that is what the panel says (before it, it says nothing). */
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState<"on" | "off" | null>(null);

  // Terminals open and end elsewhere too (another tab, another app, by themselves): the list
  // asks again every second while the page is open.
  useEffect(() => {
    if (!online || !enabled) return;
    const load = () =>
      store.terminals
        .host(host.id)
        .list()
        .then(setLive, (error: unknown) => {
          // The host says its terminals are off: nothing is open. Any other failure leaves the list
          // unknown, and keeps the last one.
          if (error instanceof RequestError && error.code === "terminal_disabled") setLive([]);
          else setFailed(true);
        });
    void load();
    const timer = setInterval(load, LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [store, host.id, online, enabled]);

  if (!online || !info?.terminal) return null;

  const apply = async (on: boolean) => {
    setAsking(null);
    await store.hostCommand(host.id, "terminal.settings", { enabled: on, confirm: true });
    await store.reloadHostInfo(host.id);
  };
  const running = live?.filter((terminal) => terminal.exitCode === null) ?? [];

  return (
    <section aria-label={t("hostTerminal.title")}>
      <Panel title={t("hostTerminal.title")}>
        {enabled ? (
          <>
            {live === null && failed && (
              <p className="text-muted-foreground text-sm">{t("hostTerminal.unreadable")}</p>
            )}
            {live === null ? null : running.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("hostTerminal.none")}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {running.map((terminal) => (
                  <li key={terminal.terminalId} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs">
                      {terminal.command} · {terminal.cwd}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t("hostTerminal.attach", { cwd: terminal.cwd })}
                      onClick={() =>
                        store.hostTabs.show({
                          name: "terminal",
                          host: host.id,
                          terminalId: terminal.terminalId,
                        })
                      }
                    >
                      {t("hostTerminal.attachShort")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <ActionButton size="sm" onClick={() => store.terminals.open(host.id)}>
                {t("hostTerminal.open")}
              </ActionButton>
              <Button variant="outline" size="sm" onClick={() => setAsking("off")}>
                {t("hostTerminal.turnOff")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm">{t("hostTerminal.off")}</p>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setAsking("on")}
            >
              {t("hostTerminal.turnOn")}
            </Button>
          </>
        )}
      </Panel>
      {asking && (
        <ConfirmDialog
          message={
            asking === "on" ? t("hostTerminal.turnOnMessage") : t("hostTerminal.turnOffMessage")
          }
          confirmLabel={asking === "on" ? t("hostTerminal.turnOn") : t("hostTerminal.turnOff")}
          destructive
          onConfirm={() => void apply(asking === "on")}
          onCancel={() => setAsking(null)}
        />
      )}
    </section>
  );
}
