/**
 * Issue #100, slice 3b: the dialog that moves a session to another host. The person picks the host
 * and the repository there, sees what moves (counts only, never a secret), says yes, watches it go
 * and opens the session on the other host. A refusal reads as the app's own text: the host's
 * message is never shown.
 */
import { memo, type ReactNode, useRef, useState } from "react";
import { Form, FormActions, NativeSelect } from "@/components/layout/form";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppDialogContent } from "../components/feedback/dialog-content.tsx";
import { useT } from "../i18n/context.tsx";
import { translateError } from "../i18n/errors.ts";
import { formatBytes } from "../lib/format-bytes.ts";
import type { RequestError } from "../lib/host-connection.ts";
import type { TeleportOutcome, TeleportSummary } from "../lib/teleport.ts";

export interface TeleportRunArgs {
  target: string;
  repo: string;
  confirm(summary: TeleportSummary): Promise<boolean>;
  onProgress(sent: number, total: number): void;
  signal: AbortSignal;
}

export interface TeleportDialogProps {
  /** The hosts the session can go to: online, with teleport, not its own. */
  targets: ReadonlyArray<{ id: string; name: string }>;
  /** The repository field for a host (the folder picker, in the app). */
  repoField(hostId: string, value: string, onChange: (path: string) => void): ReactNode;
  run(args: TeleportRunArgs): Promise<TeleportOutcome>;
  onOpen(hostId: string, sessionId: string): void;
  onClose(): void;
}

type Phase =
  | { at: "pick" }
  | { at: "confirm"; summary: TeleportSummary }
  | { at: "moving"; percent: number }
  | { at: "done"; sessionId: string }
  | { at: "failed"; text: string };

/** The share sent, from 0 to 100 whatever the numbers say. */
const percentOf = (sent: number, total: number) =>
  total > 0 ? Math.min(100, Math.max(0, Math.round((sent / total) * 100))) : 0;

export const TeleportDialog = memo(function TeleportDialog(props: TeleportDialogProps) {
  const t = useT();
  const [target, setTarget] = useState("");
  const [repo, setRepo] = useState("");
  const [phase, setPhase] = useState<Phase>({ at: "pick" });
  const answer = useRef<((yes: boolean) => void) | null>(null);
  const stop = useRef<AbortController | null>(null);
  const host = props.targets.find((h) => h.id === target)?.name ?? "";

  const begin = () => {
    const controller = new AbortController();
    stop.current = controller;
    props
      .run({
        target,
        repo,
        signal: controller.signal,
        confirm: (summary) =>
          new Promise<boolean>((resolve) => {
            answer.current = resolve;
            setPhase({ at: "confirm", summary });
          }),
        onProgress: (sent, total) => setPhase({ at: "moving", percent: percentOf(sent, total) }),
      })
      .then(
        (outcome) =>
          outcome.kind === "moved"
            ? setPhase({ at: "done", sessionId: outcome.sessionId })
            : props.onClose(),
        (error: RequestError) => {
          // The app's own text for the reason: the host's message never reaches the screen.
          const why = error.reason ? { reason: error.reason, params: error.params ?? {} } : {};
          setPhase({ at: "failed", text: translateError(error.code, "", t, why).title });
        },
      );
  };

  const reply = (yes: boolean) => {
    answer.current?.(yes);
    answer.current = null;
    if (yes) setPhase({ at: "moving", percent: 0 });
  };

  const dismiss = () => {
    if (phase.at === "confirm") reply(false);
    else if (phase.at === "moving") stop.current?.abort();
    else props.onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("teleportUi.title")}</DialogTitle>
        </DialogHeader>
        {phase.at === "pick" && (
          <Form variant="dialog" onSubmit={begin}>
            <NativeSelect
              aria-label={t("teleportUi.host")}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">{t("teleportUi.pickHost")}</option>
              {props.targets.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </NativeSelect>
            {target && (
              <>
                <p>{t("teleportUi.repo")}</p>
                {props.repoField(target, repo, setRepo)}
              </>
            )}
            <FormActions
              submit={t("teleportUi.next")}
              disabled={!target || !repo}
              cancel={t("teleportUi.cancel")}
              onCancel={props.onClose}
            />
          </Form>
        )}
        {phase.at === "confirm" && (
          <Form variant="dialog" onSubmit={() => reply(true)}>
            <p>
              {t("teleportUi.branch")}{" "}
              {phase.summary.branch ? (
                <bdi className="font-mono">{phase.summary.branch}</bdi>
              ) : (
                t("teleportUi.noBranch")
              )}
            </p>
            <p>{t("teleportUi.ahead", { n: phase.summary.ahead })}</p>
            <p>{t("teleportUi.changed", { n: phase.summary.changed })}</p>
            <p>{t("teleportUi.size", { size: formatBytes(phase.summary.bytes) })}</p>
            <p>{t("teleportUi.secrets", { n: phase.summary.secretLines })}</p>
            <FormActions
              submit={t("teleportUi.move")}
              cancel={t("teleportUi.back")}
              onCancel={() => reply(false)}
            />
          </Form>
        )}
        {phase.at === "moving" && (
          <Form variant="dialog" onSubmit={() => stop.current?.abort()}>
            <p role="status">{t("teleportUi.moving", { percent: phase.percent })}</p>
            <FormActions submit={t("teleportUi.cancel")} />
          </Form>
        )}
        {phase.at === "done" && (
          <Form variant="dialog" onSubmit={() => props.onOpen(target, phase.sessionId)}>
            <p role="status">{t("teleportUi.done", { host })}</p>
            <FormActions
              submit={t("teleportUi.open")}
              cancel={t("teleportUi.close")}
              onCancel={props.onClose}
            />
          </Form>
        )}
        {phase.at === "failed" && (
          <Form variant="dialog" onSubmit={props.onClose}>
            <p role="alert">{phase.text}</p>
            <FormActions submit={t("teleportUi.close")} />
          </Form>
        )}
      </AppDialogContent>
    </Dialog>
  );
});
