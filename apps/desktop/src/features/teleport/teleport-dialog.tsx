/**
 * Issue #100, slice 3b: the dialog that moves a session to another host. The person picks the host
 * and the repository there, sees what moves (counts only, never a secret), says yes, watches it go
 * and opens the session on the other host. A refusal reads as the app's own text: the host's
 * message is never shown.
 */
import { memo, type ReactNode, useRef, useState } from "react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RequestError } from "@/features/hosts/index.ts";
import { Bar, Form, FormActions, NativeSelect } from "@/shared/layout/index.ts";
import { formatBytes } from "@/shared/lib/index.ts";
import { useT } from "../../i18n/context.tsx";
import { translateError } from "../../i18n/errors.ts";
import { AppDialogContent, InlineNotice } from "../../shared/feedback/index.ts";
import {
  plainText,
  type TeleportOutcome,
  type TeleportRunArgs,
  type TeleportSummary,
} from "./teleport.ts";

export interface TeleportDialogProps {
  /** The hosts the session can go to: online, with teleport, not its own. */
  targets: ReadonlyArray<{ id: string; name: string }>;
  /** The repository field for a host (the folder picker, in the app). */
  repoField(hostId: string, value: string, onChange: (path: string) => void): ReactNode;
  /** The names of the hosts, the source and `target`, reached over plain `ws://` off this machine. */
  plain?(target: string): string[];
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
  /** `again`: the move did not land, so it can be tried once more; a move with no session id may have landed. */
  | { at: "failed"; text: string; again: boolean };

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
export function failureText(error: unknown, t: ReturnType<typeof useT>): string {
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
  const [picked, setPicked] = useState("");
  const [repo, setRepo] = useState("");
  const [phase, setPhase] = useState<Phase>({ at: "pick" });
  // In the first step a host that is no longer offered (it went offline) counts as not picked.
  const target = phase.at === "pick" && !props.targets.some((h) => h.id === picked) ? "" : picked;
  const answer = useRef<((yes: boolean) => void) | null>(null);
  const stop = useRef<AbortController | null>(null);
  const closed = useRef(false);
  const host = props.targets.find((h) => h.id === target)?.name ?? "";
  const plain = target ? (props.plain?.(target) ?? []) : [];

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
            return setPhase({ at: "failed", text: failureText(null, t), again: false });
          }
          setPhase({ at: "done", sessionId: outcome.sessionId });
        },
        (error: unknown) => setPhase({ at: "failed", text: failureText(error, t), again: true }),
      );
  };

  /** After a failure: back to the first step with the host and the repository kept, free for a new move. */
  const retry = () => {
    stop.current = null;
    // The host may have gone offline while the move ran: a host the list no longer offers is dropped.
    if (!props.targets.some((h) => h.id === picked)) {
      setPicked("");
      setRepo("");
    }
    setPhase({ at: "pick" });
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
        {phase.at === "pick" && props.targets.length === 0 && (
          <Form variant="dialog" onSubmit={close}>
            <p role="note">{t("teleportUi.noTarget")}</p>
            <FormActions submit={t("teleportUi.close")} />
          </Form>
        )}
        {(phase.at === "preparing" || (phase.at === "pick" && props.targets.length > 0)) && (
          <Form variant="dialog" onSubmit={begin}>
            <NativeSelect
              aria-label={t("teleportUi.host")}
              disabled={phase.at === "preparing"}
              value={target}
              onChange={(e) => {
                setPicked(e.target.value);
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
            {phase.at === "preparing" && (
              <output className="block">{t("teleportUi.preparing")}</output>
            )}
            <FormActions
              submit={t("teleportUi.next")}
              disabled={!target || !repo.trim()}
              disabledReason={t(target ? "teleportUi.repoReason" : "teleportUi.pickHostReason")}
              busy={phase.at === "preparing"}
              cancel={t("teleportUi.cancel")}
              onCancel={leave}
            />
          </Form>
        )}
        {phase.at === "confirm" && (
          <Form variant="dialog" onSubmit={() => reply(true)}>
            <p>
              {t("teleportUi.to")} {host} ·{" "}
              <span className="break-all font-mono">{repo.trim()}</span>
            </p>
            <p>
              {t("teleportUi.branch")}{" "}
              {phase.summary.branch ? (
                <bdi className="break-all font-mono">{phase.summary.branch}</bdi>
              ) : (
                t("teleportUi.noBranch")
              )}
            </p>
            <p>{t("teleportUi.ahead", { n: phase.summary.ahead })}</p>
            <p>{t("teleportUi.changed", { n: phase.summary.changed })}</p>
            <p>{t("teleportUi.size", { size: formatBytes(phase.summary.bytes) })}</p>
            <p className={phase.summary.secretLines > 0 ? "text-status-needs-you" : undefined}>
              {t("teleportUi.secrets", { n: phase.summary.secretLines })}
            </p>
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
            <output className="block">
              {phase.finishing
                ? t("teleportUi.finishing", { host })
                : t("teleportUi.moving", { percent: phase.percent })}
            </output>
            <div
              role="progressbar"
              aria-label={t("teleportUi.progress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={phase.percent}
              className="w-full"
            >
              <Bar ratio={phase.percent / 100} />
            </div>
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
            <output className="block">{t("teleportUi.done", { host })}</output>
            <FormActions
              submit={t("teleportUi.open")}
              cancel={t("teleportUi.close")}
              onCancel={close}
            />
          </Form>
        )}
        {phase.at === "failed" && (
          <Form variant="dialog" onSubmit={phase.again ? retry : close}>
            <p role="alert">{phase.text}</p>
            {phase.again ? (
              <FormActions
                submit={t("teleportUi.retry")}
                cancel={t("teleportUi.close")}
                onCancel={close}
              />
            ) : (
              <FormActions submit={t("teleportUi.close")} />
            )}
          </Form>
        )}
        {/* After the form: showing it when a host is picked moves nothing the person is using. */}
        {plain.length > 0 &&
          (phase.at === "pick" || phase.at === "preparing" || phase.at === "confirm") && (
            <InlineNotice>
              {t("teleportUi.plainWs", { n: plain.length, hosts: plain.join(", ") })}
            </InlineNotice>
          )}
      </AppDialogContent>
    </Dialog>
  );
});
