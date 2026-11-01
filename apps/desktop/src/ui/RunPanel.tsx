import type { Card, RunConfigInfo } from "@flightdeck/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Panel } from "@/components/layout/panel";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { type AppStore, sessionKey } from "../lib/app-store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const LIVE = new Set(["setup", "running"]);

/** A card's run environment: trust the run.yaml, Run and Stop, its processes and their preview. */
export function RunPanel(props: { store: AppStore; hostId: string; card: Card }) {
  const { store, hostId, card } = props;
  const t = useT();
  const state = useSyncExternalStore(store.subscribe, store.getState).runEnvs[
    sessionKey(hostId, card.id)
  ];
  const [info, setInfo] = useState<RunConfigInfo | null>(null);
  const [trusting, setTrusting] = useState(false);

  useEffect(() => {
    let alive = true;
    void store.runEnvConfig(hostId, card.projectId).then((found) => alive && setInfo(found));
    return () => {
      alive = false;
    };
  }, [store, hostId, card.projectId]);

  if (!info?.exists) return null;
  const status = state?.status ?? "idle";
  const live = LIVE.has(status);
  const trust = async () => {
    setTrusting(false);
    if (info.hash) setInfo(await store.runTrust(hostId, card.projectId, info.hash));
  };
  const open = (name: "terminal" | "preview", terminalId: string, url = "", title = "") => {
    if (name === "terminal") store.tabs.open({ name, host: hostId, terminalId });
    else store.tabs.open({ name, url, title });
  };

  return (
    <section aria-label={t("runEnv.title")}>
      <Panel title={t("runEnv.title")}>
        {info.errors.length > 0 && (
          <Stack gap={1} className="text-sm">
            <p>{t("runEnv.errors")}</p>
            {info.errors.map((error) => (
              <p key={error} className="font-mono text-status-error text-xs">
                {error}
              </p>
            ))}
          </Stack>
        )}
        {info.config && !info.trusted && (
          <>
            <p className="text-muted-foreground text-sm">{t("runEnv.review")}</p>
            <Stack as="ul" gap={1} className="text-sm">
              {info.config.setup && (
                <li>
                  <Inline gap={2}>
                    <span className="text-muted-foreground">{t("runEnv.setupLabel")}</span>
                    <code className="font-mono text-xs">{info.config.setup.join(" ")}</code>
                  </Inline>
                </li>
              )}
              {info.config.run.map((process) => (
                <li key={process.name}>
                  <Inline gap={2}>
                    <span>{process.name}</span>
                    <code className="font-mono text-xs">{process.cmd.join(" ")}</code>
                  </Inline>
                </li>
              ))}
            </Stack>
            <Button size="sm" className="self-start" onClick={() => setTrusting(true)}>
              {t("runEnv.trust")}
            </Button>
          </>
        )}
        {info.config && info.trusted && (
          <>
            <Inline gap={2}>
              {live ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void store.runStop(hostId, card.id)}
                >
                  {t("runEnv.stop")}
                </Button>
              ) : (
                <Button size="sm" onClick={() => void store.runStart(hostId, card.id)}>
                  {t("runEnv.run")}
                </Button>
              )}
              <span className="text-sm">{t(`runEnv.status.${status}`)}</span>
            </Inline>
            {state?.error && <p className="text-status-error text-sm">{state.error}</p>}
            {state && Object.keys(state.ports).length > 0 && (
              <p className="text-muted-foreground text-sm">
                {t("runEnv.ports", {
                  ports: Object.entries(state.ports)
                    .map(([name, port]) => `${name} ${port}`)
                    .join(", "),
                })}
              </p>
            )}
            {state?.setupTerminalId && (
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => open("terminal", state.setupTerminalId ?? "")}
              >
                {t("runEnv.viewLog", { name: t("runEnv.setupLabel") })}
              </Button>
            )}
            <Stack as="ul" gap={2} className="text-sm">
              {state?.processes.map((process) => (
                <li key={process.terminalId}>
                  <Inline gap={2}>
                    <span className="font-medium">{process.name}</span>
                    <span className="text-muted-foreground">
                      {process.status === "running"
                        ? t("runEnv.procRunning")
                        : t("runEnv.procExited", { code: String(process.exitCode) })}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => open("terminal", process.terminalId)}
                    >
                      {t("runEnv.viewLog", { name: process.name })}
                    </Button>
                    {process.ready === "ready" && process.url && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => open("preview", "", process.url ?? "", process.name)}
                      >
                        {t("runEnv.openPreview", { name: process.name })}
                      </Button>
                    )}
                    {process.ready === "waiting" && (
                      <span className="text-muted-foreground text-xs">
                        {t("runEnv.previewWaiting", { name: process.name })}
                      </span>
                    )}
                    {process.ready === "timeout" && (
                      <span className="text-muted-foreground text-xs">
                        {t("runEnv.previewTimeout", { name: process.name })}
                      </span>
                    )}
                  </Inline>
                </li>
              ))}
            </Stack>
          </>
        )}
      </Panel>
      {trusting && (
        <ConfirmDialog
          message={t("runEnv.trustMessage")}
          confirmLabel={t("runEnv.trustConfirm")}
          onConfirm={() => void trust()}
          onCancel={() => setTrusting(false)}
        />
      )}
    </section>
  );
}
