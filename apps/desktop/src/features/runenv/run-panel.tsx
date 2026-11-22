import type { Card, RunConfigInfo, RunProcessState } from "@flightdeck/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { reasonText } from "@/i18n/errors";
import { ActionButton, ConfirmDialog } from "@/shared/feedback/index.ts";
import { Inline, Panel, Stack } from "@/shared/layout/index.ts";
import { type AppStore, sessionKey } from "../../lib/app-store.ts";

const LIVE = new Set(["setup", "running"]);

/** How a process is doing, in words: a process that ended with no exit code (a signal) says so. */
function processState(process: RunProcessState, t: ReturnType<typeof useT>): string {
  if (process.status === "running") return t("runEnv.procRunning");
  if (process.exitCode === null) return t("runEnv.procEndedNoCode");
  return t("runEnv.procExited", { code: String(process.exitCode) });
}

/** A card's run environment: trust the run.yaml, Run and Stop, its processes and their preview. */
export function RunPanel(props: Readonly<{ store: AppStore; hostId: string; card: Card }>) {
  const { store, hostId, card } = props;
  const t = useT();
  const state = useSyncExternalStore(store.subscribe, store.getState).runEnvs[
    sessionKey(hostId, card.id)
  ];
  const [info, setInfo] = useState<RunConfigInfo | null>(null);
  const [trusting, setTrusting] = useState(false);
  // Stop kills the processes, so their codes are not a crash: only the run after the last Stop can crash.
  const [stoppedByPerson, setStoppedByPerson] = useState(false);

  useEffect(() => {
    let alive = true;
    void store.runEnv.config(hostId, card.projectId).then((found) => alive && setInfo(found));
    return () => {
      alive = false;
    };
  }, [store, hostId, card.projectId]);

  if (!info?.exists) return null;
  const status = state?.status ?? "idle";
  const live = LIVE.has(status);
  const trust = async () => {
    setTrusting(false);
    if (info.hash) setInfo(await store.runEnv.trust(hostId, card.projectId, info.hash));
  };
  const open = (name: "terminal" | "preview", terminalId: string, url = "", title = "") => {
    if (name === "terminal") store.hostTabs.show({ name, host: hostId, terminalId });
    else store.hostTabs.show({ name, url, title });
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
                <ActionButton
                  key="stop"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setStoppedByPerson(true);
                    return store.runEnv.stop(hostId, card.id);
                  }}
                >
                  {t("runEnv.stop")}
                </ActionButton>
              ) : (
                <ActionButton
                  key="run"
                  size="sm"
                  onClick={() => {
                    setStoppedByPerson(false);
                    return store.runEnv.start(hostId, card.id);
                  }}
                >
                  {t("runEnv.run")}
                </ActionButton>
              )}
              <output className="text-sm">{t(`runEnv.status.${status}`)}</output>
            </Inline>
            {state?.error && (
              <p role="alert" className="text-status-error text-sm">
                {reasonText(t, state.error, state.errorKey, state.errorParams)}
              </p>
            )}
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
                    <span
                      className={
                        !stoppedByPerson && process.status === "exited" && process.exitCode !== 0
                          ? "text-status-error"
                          : "text-muted-foreground"
                      }
                    >
                      {processState(process, t)}
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
