import type { AutoApprovalRecord, AutoApproveSuspension } from "@flightdeck/protocol";
import { ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ActionButton, ConfirmDialog } from "@/shared/feedback/index.ts";
import { useMinLoading } from "@/shared/hooks/index.ts";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NativeSelect,
  Page,
  Toolbar,
} from "@/shared/layout/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";

/**
 * What the automatic approval decided on a host (newest first, filtered by project and text) and
 * the sessions it suspended, which only a confirmed Resume turns back on.
 */
export function AutoApprovalsPage(props: Readonly<{ store: AppStore; hostId: string }>) {
  const { store, hostId } = props;
  const { t } = store.i18n;
  const [decisions, setDecisions] = useState<AutoApprovalRecord[] | null>(null);
  const [suspended, setSuspended] = useState<AutoApproveSuspension[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [text, setText] = useState("");
  const [resuming, setResuming] = useState<AutoApproveSuspension | null>(null);
  const [resumingNow, setResumingNow] = useState<string | null>(null);
  const [loadRefusal, setLoadRefusal] = useState<string | null>(null);
  // Bumped by "Try again": the list is read again with the same filter.
  const [attempt, setAttempt] = useState(0);
  const suspendedList = useRef<HTMLElement>(null);
  const decisionsList = useRef<HTMLElement>(null);
  const resumeButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusButtonOf = useRef<string | null>(null);
  const projects = store.getState().projects[hostId];
  const loading = useMinLoading(decisions === null);

  useEffect(() => {
    if (projects === undefined) void store.projectList.load(hostId);
  }, [store, hostId, projects]);
  useEffect(() => {
    // `attempt` re-runs this read; a slower answer of an older filter must not land.
    void attempt; // NOSONAR: reads `attempt` only so a new attempt re-runs this effect (it is in the dependency list)
    let current = true;
    setLoadRefusal(null);
    void store
      .hostRequest(hostId, "autoapprove.list", projectId ? { projectId } : {})
      .then((result) => {
        if (!current) return;
        if (!result.ok) {
          setLoadRefusal(result.message);
          return;
        }
        setDecisions(result.data.decisions);
        setSuspended(result.data.suspended);
      });
    return () => {
      current = false;
    };
  }, [store, hostId, projectId, attempt]);
  // The previous project's rows are not offered as the new one's: they give way to the loading line.
  const pickProject = (id: string) => {
    setProjectId(id);
    setDecisions(null);
  };
  // A Resume that did not go through leaves its button: the focus goes back to it once it is on.
  useEffect(() => {
    if (resumingNow !== null || focusButtonOf.current === null) return;
    resumeButtons.current.get(focusButtonOf.current)?.focus();
    focusButtonOf.current = null;
  }, [resumingNow]);

  const resume = async (item: AutoApproveSuspension) => {
    setResuming(null);
    setResumingNow(item.sessionKey);
    // A host with a device enrolled wants its signature over the session; a no in the device's dialog sends nothing (#3453).
    try {
      const made = await store.approval.resumePayload(hostId, item.sessionKey);
      const result =
        made.kind === "payload"
          ? await store.hostCommand(hostId, "autoapprove.resume", made.payload)
          : null;
      if (result) {
        setSuspended(result.suspended);
        // The row and its button are gone: the focus stays in the list.
        suspendedList.current?.focus();
      } else {
        focusButtonOf.current = item.sessionKey;
      }
    } catch (error) {
      store.reportError(error instanceof Error ? error.message : String(error));
      focusButtonOf.current = item.sessionKey;
    } finally {
      setResumingNow(null);
    }
  };

  const needle = text.trim().toLowerCase();
  const shown = (decisions ?? []).filter(
    (d) =>
      !needle ||
      d.toolName.toLowerCase().includes(needle) ||
      d.reason.toLowerCase().includes(needle),
  );

  return (
    <Page
      title={t("autoApprovalsUi.open")}
      subtitle={t("autoApprovalsUi.openHint")}
      toolbar={
        <Toolbar label={t("autoApprovalsUi.list")}>
          <NativeSelect
            inline
            compact
            aria-label={t("autoApprovalsUi.project")}
            value={projectId}
            onChange={(e) => pickProject(e.target.value)}
          >
            <option value="">{t("autoApprovalsUi.allProjects")}</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <Input
            aria-label={t("autoApprovalsUi.filter")}
            placeholder={t("autoApprovalsUi.filterPlaceholder")}
            className="h-8 w-56 text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Toolbar>
      }
    >
      <div className="flex max-w-3xl flex-col gap-5">
        <section
          ref={suspendedList}
          tabIndex={-1}
          aria-label={t("autoApprovalsUi.suspended")}
          className="flex flex-col gap-2 outline-none focus-visible:outline-2 focus-visible:outline-ring"
        >
          <h2 className="font-medium text-sm">{t("autoApprovalsUi.suspended")}</h2>
          {suspended?.length === 0 && (
            <p className="text-muted-foreground text-sm">{t("autoApprovalsUi.noSuspended")}</p>
          )}
          {(suspended ?? []).map((s) => (
            <div
              key={s.sessionKey}
              className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <span className="flex flex-col">
                <span className="font-mono text-xs">{s.sessionKey}</span>
                <span>{s.reason}</span>
              </span>
              <ActionButton
                variant="outline"
                size="sm"
                ref={(button: HTMLButtonElement | null) => {
                  if (button) resumeButtons.current.set(s.sessionKey, button);
                  else resumeButtons.current.delete(s.sessionKey);
                }}
                pending={resumingNow === s.sessionKey}
                // One proof at a time: another row waits, so none is sent twice or its state overwritten.
                disabled={resumingNow !== null && resumingNow !== s.sessionKey}
                aria-label={t("autoApprovalsUi.resume", { session: s.sessionKey })}
                onClick={() => setResuming(s)}
              >
                {t("autoApprovalsUi.resumeConfirm")}
              </ActionButton>
            </div>
          ))}
        </section>
        <section
          ref={decisionsList}
          tabIndex={-1}
          className="flex flex-col gap-2 outline-none focus-visible:outline-2 focus-visible:outline-ring"
        >
          {loadRefusal !== null && (
            <ErrorState
              message={loadRefusal}
              retryLabel={t("autoApprovalsUi.retry")}
              onRetry={() => {
                // The pressed button goes away with the error: the focus moves to its section first.
                decisionsList.current?.focus();
                setAttempt((n) => n + 1);
              }}
            />
          )}
          {loading && loadRefusal === null && <LoadingState label={t("autoApprovalsUi.loading")} />}
          {decisions?.length === 0 && (
            <EmptyState
              icon={ShieldCheck}
              title={t("autoApprovalsUi.empty")}
              action={
                <p className="text-muted-foreground text-xs">{t("autoApprovalsUi.emptyHint")}</p>
              }
            />
          )}
          {decisions !== null && decisions.length > 0 && shown.length === 0 && (
            <p className="text-muted-foreground text-sm">{t("autoApprovalsUi.noMatch")}</p>
          )}
          {shown.length > 0 && (
            <ul aria-label={t("autoApprovalsUi.list")} className="flex flex-col gap-2">
              {shown.map((d) => (
                <li key={d.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{d.toolName}</span>
                    <Badge variant="outline">{t(`approval.risk.${d.risk}` as Key)}</Badge>
                    <Badge variant={d.decision === "allow" ? "secondary" : "outline"}>
                      {d.decision === "allow"
                        ? t("autoApprovalsUi.allow")
                        : t("autoApprovalsUi.ask")}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {d.by === "ai"
                        ? t("autoApprovalsUi.byAi", { model: d.model ?? "" })
                        : t("autoApprovalsUi.byRule")}
                    </span>
                    <span className="ml-auto text-muted-foreground text-xs">
                      {store.formatDateTime(d.at)}
                    </span>
                  </span>
                  <span className="text-muted-foreground">{d.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {resuming && (
        <ConfirmDialog
          message={t("autoApprovalsUi.resumeMessage", {
            session: resuming.sessionKey,
            reason: resuming.reason,
          })}
          confirmLabel={t("autoApprovalsUi.resumeConfirm")}
          onConfirm={() => void resume(resuming)}
          onCancel={() => setResuming(null)}
          onRestoreFocus={() => {
            const key = resuming.sessionKey;
            (resumeButtons.current.get(key) ?? suspendedList.current)?.focus();
          }}
        />
      )}
    </Page>
  );
}
