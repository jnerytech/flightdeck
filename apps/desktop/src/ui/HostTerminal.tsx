import type { TerminalInfo } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "../lib/app-store.ts";
import { hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/** How often the list of live terminals is asked again. */
const LIST_REFRESH_MS = 1000;

/**
 * The host's embedded terminals (phase 14): a new one, the live ones, and turning them on (which
 * asks, since a terminal is a full shell on the host) or off (which ends the live ones).
 */
export function HostTerminal(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  const info = host.hostInfo;
  const online = host.status === "online";
  const enabled = hasFeature(info?.features, "terminal", false);
  const [live, setLive] = useState<TerminalInfo[]>([]);
  const [asking, setAsking] = useState<"on" | "off" | null>(null);

  // Terminals open and end elsewhere too (another tab, another app, by themselves): the list
  // asks again every second while the page is open.
  useEffect(() => {
    if (!online || !enabled) return;
    const load = () =>
      store
        .terminalHost(host.id)
        .list()
        .then(setLive, () => setLive([]));
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
  const running = live.filter((terminal) => terminal.exitCode === null);

  return (
    <section aria-label={t("hostTerminal.title")}>
      <Panel title={t("hostTerminal.title")}>
        {enabled ? (
          <>
            {running.length === 0 ? (
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
                        store.tabs.open({
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
              <ActionButton size="sm" onClick={() => store.openTerminal(host.id)}>
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
