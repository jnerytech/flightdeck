import type { Card, RunConfigInfo } from "@flightdeck/protocol";
import { type MouseEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { reasonText } from "@/i18n/errors";
import { ActionButton, ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { Inline, Panel, Stack } from "@/shared/layout/index.ts";
import { type AppStore, sessionKey } from "../../lib/app-store.ts";
import { processChanges, processState } from "./domain/process-changes.ts";

const LIVE = new Set(["setup", "running"]);

/** A card's run environment: trust the run.yaml, Run and Stop, its processes and their preview. */
export function RunPanel(props: Readonly<{ store: AppStore; hostId: string; card: Card }>) {
  const { store, hostId, card } = props;
  const t = useT();
  const state = useSyncExternalStore(store.subscribe, store.getState).runEnvs[
    sessionKey(hostId, card.id)
  ];
  const [info, setInfo] = useState<RunConfigInfo | null>(null);
  const [trusting, setTrusting] = useState(false);
  // The host refused the last Trust: the review stays, with a line saying so.
  const [trustRefused, setTrustRefused] = useState(false);
  // A Trust the person confirmed: once it is accepted, the Trust button is gone and Run takes the focus.
  const focusRun = useRef(false);
  // Stop kills the processes, so their codes are not a crash: only the run after the last Stop can crash.
  const [stoppedByPerson, setStoppedByPerson] = useState(false);

  useEffect(() => {
    let alive = true;
    void store.runEnv.config(hostId, card.projectId).then((found) => alive && setInfo(found));
    return () => {
      alive = false;
    };
  }, [store, hostId, card.projectId]);

  const status = state?.status ?? "idle";
  const live = LIVE.has(status);
  const section = useRef<HTMLElement>(null);
  // Run and Stop swap in one place, so the pressed one unmounts: when the person pressed it with the
  // focus on it, its replacement takes the focus (#4063). A change the person did not cause moves
  // nothing: the press names the run state it asked for and keeps that claim while its request is in
  // flight, however slow the host is; once the request ends and no change came with it, it was refused
  // and the claim is dropped.
  const handOff = useRef<boolean | null>(null);
  const press = (
    event: MouseEvent<HTMLButtonElement>,
    toLive: boolean,
    work: () => Promise<void>,
  ) => {
    const claim = document.activeElement === event.currentTarget ? toLive : null;
    handOff.current = claim;
    return work().finally(() =>
      setTimeout(() => {
        if (handOff.current === claim) handOff.current = null;
      }, 0),
    );
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: it runs when the run starts or ends, not on every render
  useEffect(() => {
    const claim = handOff.current;
    handOff.current = null;
    const active = document.activeElement;
    if (claim !== live || (active && active !== document.body)) return;
    section.current
      ?.querySelector<HTMLElement>(`[data-action="${live ? "stop" : "run"}"]`)
      ?.focus();
  }, [live]);

  const trusted = info?.trusted === true;
  useEffect(() => {
    if (!trusted || !focusRun.current) return;
    focusRun.current = false;
    // The person may have moved on while the host answered: only the page body gives the focus up.
    const active = document.activeElement;
    if (active && active !== document.body) return;
    section.current?.querySelector<HTMLElement>('[data-action="run"]')?.focus();
  }, [trusted]);

  // What changed in the processes since the last report, said for a screen reader (not at mount).
  const processes = state?.processes;
  const seen = useRef(processes);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const before = seen.current;
    seen.current = processes;
    if (!before || !processes || before === processes) return;
    const line = processChanges(before, processes, t);
    if (line) setSaid(line);
  }, [processes, t]);

  if (!info?.exists) return null;
  const trust = async () => {
    setTrusting(false);
    if (!info.hash) return;
    const accepted = await store.runEnv.trust(hostId, card.projectId, info.hash);
    setTrustRefused(accepted?.trusted !== true);
    if (accepted?.trusted) {
      focusRun.current = true;
      setInfo(accepted);
      return;
    }
    // A refusal may mean the file changed since it was reviewed: show what it says now.
    const found = await store.runEnv.config(hostId, card.projectId);
    if (found) setInfo(found);
  };
  const open = (name: "terminal" | "preview", terminalId: string, url = "", title = "") => {
    if (name === "terminal") store.hostTabs.show({ name, host: hostId, terminalId });
    else store.hostTabs.show({ name, url, title });
  };

  return (
    <section ref={section} aria-label={t("runEnv.title")}>
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
                    <code className="font-mono text-xs [overflow-wrap:anywhere]">
                      {info.config.setup.join(" ")}
                    </code>
                  </Inline>
                </li>
              )}
              {info.config.run.map((process) => (
                <li key={process.name}>
                  <Inline gap={2}>
                    <span>{process.name}</span>
                    <code className="font-mono text-xs [overflow-wrap:anywhere]">
                      {process.cmd.join(" ")}
                    </code>
                  </Inline>
                </li>
              ))}
            </Stack>
            <Button
              size="sm"
              className="self-start"
              data-action="trust"
              onClick={() => setTrusting(true)}
            >
              {t("runEnv.trust")}
            </Button>
            {trustRefused && <InlineNotice tone="error">{t("runEnv.trustRefused")}</InlineNotice>}
          </>
        )}
        {info.config && info.trusted && (
          <>
            <Inline gap={2}>
              {live ? (
                <ActionButton
                  key="stop"
                  data-action="stop"
                  size="sm"
                  variant="outline"
                  onClick={(event) => {
                    setStoppedByPerson(true);
                    return press(event, false, () => store.runEnv.stop(hostId, card.id));
                  }}
                >
                  {t("runEnv.stop")}
                </ActionButton>
              ) : (
                <ActionButton
                  key="run"
                  data-action="run"
                  size="sm"
                  onClick={(event) => {
                    setStoppedByPerson(false);
                    return press(event, true, () => store.runEnv.start(hostId, card.id));
                  }}
                >
                  {t("runEnv.run")}
                </ActionButton>
              )}
              <output className="text-sm">{t(`runEnv.status.${status}`)}</output>
              <output className="sr-only">{said}</output>
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
            {state && state.processes.length > 0 && (
              <Stack as="ul" gap={2} className="text-sm" label={t("runEnv.processes")}>
                {state.processes.map((process) => (
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
            )}
          </>
        )}
      </Panel>
      {trusting && (
        <ConfirmDialog
          message={t("runEnv.trustMessage")}
          confirmLabel={t("runEnv.trustConfirm")}
          // Radix would return the focus to Trust, which an accepted Trust removes: Run is there then.
          onRestoreFocus={() =>
            section.current
              ?.querySelector<HTMLElement>('[data-action="run"], [data-action="trust"]')
              ?.focus()
          }
          onConfirm={() => void trust()}
          onCancel={() => setTrusting(false)}
        />
      )}
    </section>
  );
}
