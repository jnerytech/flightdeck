import type { InterruptedSession } from "@flightdeck/protocol";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { basename } from "@/lib/paths";
import { byProject, CONTINUATION } from "@/lib/resume-offer";

type Outcome = { ok: true } | { ok: false; reason: string };

/**
 * The sessions a daemon restart interrupted, in one dialog (issue #150): grouped by project, all
 * ticked, with what resume sends. "Not now" keeps the offer on the host page; "Dismiss all" drops it.
 */
export function ResumeOfferDialog(props: {
  store: AppStore;
  hostId: string;
  hostName: string;
  sessions: InterruptedSession[];
  resumed: string[];
}) {
  const { store, hostId } = props;
  const t = useT();
  const [off, setOff] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<Record<string, Outcome>>({});
  const nameOf = (s: InterruptedSession) => s.name ?? basename(s.cwd);
  const chosen = props.sessions.filter(
    (s) => !off.has(s.sessionId) && !props.resumed.includes(s.sessionId),
  );
  const run = async (list: InterruptedSession[]) => {
    const done = await store.resumeInterrupted(hostId, list);
    setOutcome((before) => ({ ...before, ...done }));
  };
  return (
    <Dialog open onOpenChange={(open) => !open && store.snoozeResumeOffer(hostId)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("resumeOffer.title")}</DialogTitle>
          <DialogDescription>
            {t("resumeOffer.intro", { host: props.hostName, text: CONTINUATION })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
          {byProject(props.sessions).map((group) => (
            <section key={group.project} aria-label={group.project} className="flex flex-col gap-1">
              <h3 className="font-medium text-muted-foreground text-xs">{group.project}</h3>
              {group.sessions.map((session) => {
                const result = outcome[session.sessionId];
                return (
                  <div key={session.sessionId} className="flex flex-col gap-0.5">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        aria-label={nameOf(session)}
                        checked={!off.has(session.sessionId)}
                        onChange={(e) =>
                          setOff((before) => {
                            const next = new Set(before);
                            if (e.target.checked) next.delete(session.sessionId);
                            else next.add(session.sessionId);
                            return next;
                          })
                        }
                      />
                      <span className="font-medium">{nameOf(session)}</span>
                      {session.persona && (
                        <span className="text-muted-foreground text-xs">{session.persona}</span>
                      )}
                      <span className="text-muted-foreground text-xs">
                        {t("resumeOffer.rowRan", {
                          n: Math.max(1, Math.round(session.ranMs / 60000)),
                        })}
                      </span>
                      {(result?.ok || props.resumed.includes(session.sessionId)) && (
                        <span className="text-xs">{t("resumeOffer.resumed")}</span>
                      )}
                    </label>
                    {session.lastRequest && (
                      <span className="ps-6 text-muted-foreground text-xs">
                        {session.lastRequest}
                      </span>
                    )}
                    {result && !result.ok && (
                      <span className="flex items-center gap-2 ps-6 text-status-error text-xs">
                        {t("resumeOffer.failed", { reason: result.reason })}
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={t("resumeOffer.retry", { name: nameOf(session) })}
                          onClick={() => void run([session])}
                        >
                          {t("resumeOffer.retry", { name: "" }).trim()}
                        </Button>
                      </span>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => store.dismissResumeOffer(hostId)}>
            {t("resumeOffer.dismissAll")}
          </Button>
          <Button variant="outline" onClick={() => store.snoozeResumeOffer(hostId)}>
            {t("resumeOffer.notNow")}
          </Button>
          <ActionButton disabled={chosen.length === 0} onClick={() => run(chosen)}>
            {t("resumeOffer.resumeSelected")}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
