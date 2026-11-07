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
import { RequestError } from "../lib/host-connection.ts";
import {
  plainText,
  type TeleportOutcome,
  type TeleportRunArgs,
  type TeleportSummary,
} from "../lib/teleport.ts";

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
  /** The source builds the package: one move per dialog, whatever is clicked again. */
  | { at: "preparing" }
  | { at: "confirm"; summary: TeleportSummary }
  /** `finishing`: every byte is on the target, which imports it; past the point of cancel. */
  | { at: "moving"; percent: number; finishing: boolean }
  | { at: "done"; sessionId: string }
  | { at: "failed"; text: string };

/** The refusals a move can meet: only these fill their text with what the host sent. */
const KNOWN = /^(teleport_|feature_off$|cwd_outside_roots$|cwd_missing$|session_not_found$)/;

/** A host's values in the app's text: plain and short, like the branch in the summary. */
const plainParams = (params: Record<string, string | number>) =>
  Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      typeof value === "string" ? plainText(value, 64) : value,
    ]),
  );

/** The app's own text for why the move stopped: never the host's message, nor its words elsewhere. */
function failureText(error: unknown, t: ReturnType<typeof useT>): string {
  const refusal = error instanceof RequestError ? error : new RequestError("internal", "");
  const why =
    refusal.reason && KNOWN.test(refusal.reason)
      ? { reason: refusal.reason, params: plainParams(refusal.params ?? {}) }
      : {};
  return translateError(refusal.code, "", t, why).title;
}

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
  const closed = useRef(false);
  const host = props.targets.find((h) => h.id === target)?.name ?? "";

  /** The dialog closes once, whatever closes it: the person, then the run that ends after. */
  const close = () => {
    if (closed.current) return;
    closed.current = true;
    props.onClose();
  };

  const begin = () => {
    // One move per dialog: a double-click or a second Enter never starts another.
    if (stop.current) return;
    const controller = new AbortController();
    stop.current = controller;
    setPhase({ at: "preparing" });
    props
      .run({
        target,
        repo: repo.trim(),
        signal: controller.signal,
        // A dialog closed while the source prepared says no, so the source's package goes.
        confirm: (summary) =>
          controller.signal.aborted
            ? Promise.resolve(false)
            : new Promise<boolean>((resolve) => {
                answer.current = resolve;
                setPhase({ at: "confirm", summary });
              }),
        onProgress: (sent, total) =>
          setPhase({
            at: "moving",
            percent: percentOf(sent, total),
            finishing: total > 0 && sent === total,
          }),
      })
      .then(
        (outcome) => {
          if (outcome.kind !== "moved") return close();
          // A move that names no session on the target did not land anywhere the app can open.
          if (typeof outcome.sessionId !== "string" || !outcome.sessionId) {
            return setPhase({ at: "failed", text: failureText(null, t) });
          }
          setPhase({ at: "done", sessionId: outcome.sessionId });
        },
        (error: unknown) => setPhase({ at: "failed", text: failureText(error, t) }),
      );
  };

  const reply = (yes: boolean) => {
    answer.current?.(yes);
    answer.current = null;
    if (yes) setPhase({ at: "moving", percent: 0, finishing: false });
  };

  /** Closing while the source prepares stops the move: its package goes once the source answers. */
  const leave = () => {
    stop.current?.abort();
    close();
  };

  const dismiss = () => {
    if (phase.at === "confirm") reply(false);
    else if (phase.at === "moving") {
      // Once the target imports, the move ends there: the dialog may close, the import goes on.
      if (phase.finishing) close();
      else stop.current?.abort();
    } else leave();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("teleportUi.title")}</DialogTitle>
        </DialogHeader>
        {(phase.at === "pick" || phase.at === "preparing") && (
          <Form variant="dialog" onSubmit={begin}>
            <NativeSelect
              aria-label={t("teleportUi.host")}
              disabled={phase.at === "preparing"}
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                // The repository was for the other host.
                setRepo("");
              }}
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
            {phase.at === "preparing" && <p role="status">{t("teleportUi.preparing")}</p>}
            <FormActions
              submit={t("teleportUi.next")}
              disabled={!target || !repo.trim()}
              busy={phase.at === "preparing"}
              cancel={t("teleportUi.cancel")}
              onCancel={leave}
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
          // Move stays where it was, busy: a double-click or Enter never lands on Cancel.
          <Form variant="dialog" onSubmit={() => {}}>
            <p role="status">
              {phase.finishing
                ? t("teleportUi.finishing", { host })
                : t("teleportUi.moving", { percent: phase.percent })}
            </p>
            <FormActions
              submit={t("teleportUi.move")}
              busy
              {...(phase.finishing
                ? { cancel: t("teleportUi.close"), onCancel: close }
                : { cancel: t("teleportUi.cancel"), onCancel: () => stop.current?.abort() })}
            />
          </Form>
        )}
        {phase.at === "done" && (
          <Form
            variant="dialog"
            onSubmit={() => {
              props.onOpen(target, phase.sessionId);
              close();
            }}
          >
            <p role="status">{t("teleportUi.done", { host })}</p>
            <FormActions
              submit={t("teleportUi.open")}
              cancel={t("teleportUi.close")}
              onCancel={close}
            />
          </Form>
        )}
        {phase.at === "failed" && (
          <Form variant="dialog" onSubmit={close}>
            <p role="alert">{phase.text}</p>
            <FormActions submit={t("teleportUi.close")} />
          </Form>
        )}
      </AppDialogContent>
    </Dialog>
  );
});
