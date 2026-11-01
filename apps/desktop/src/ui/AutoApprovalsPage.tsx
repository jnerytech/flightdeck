import type { AutoApprovalRecord, AutoApproveSuspension } from "@flightdeck/protocol";
import { ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { Toolbar } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMinLoading } from "@/hooks/use-min-loading";
import type { Key } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/**
 * What the automatic approval decided on a host (newest first, filtered by project and text) and
 * the sessions it suspended, which only a confirmed Resume turns back on.
 */
export function AutoApprovalsPage(props: { store: AppStore; hostId: string }) {
  const { store, hostId } = props;
  const { t } = store.i18n;
  const [decisions, setDecisions] = useState<AutoApprovalRecord[] | null>(null);
  const [suspended, setSuspended] = useState<AutoApproveSuspension[]>([]);
  const [projectId, setProjectId] = useState("");
  const [text, setText] = useState("");
  const [resuming, setResuming] = useState<AutoApproveSuspension | null>(null);
  const projects = store.getState().projects[hostId];
  const loading = useMinLoading(decisions === null);

  useEffect(() => {
    if (projects === undefined) void store.loadProjects(hostId);
  }, [store, hostId, projects]);
  const load = useCallback(async () => {
    const result = await store.hostCommand(
      hostId,
      "autoapprove.list",
      projectId ? { projectId } : {},
    );
    if (!result) return;
    setDecisions(result.decisions);
    setSuspended(result.suspended);
  }, [store, hostId, projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  const resume = async (item: AutoApproveSuspension) => {
    setResuming(null);
    const result = await store.hostCommand(hostId, "autoapprove.resume", {
      sessionKey: item.sessionKey,
      confirm: true,
    });
    if (result) setSuspended(result.suspended);
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
            onChange={(e) => setProjectId(e.target.value)}
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
        <section className="flex flex-col gap-2">
          <h2 className="font-medium text-sm">{t("autoApprovalsUi.suspended")}</h2>
          {suspended.length === 0 && (
            <p className="text-muted-foreground text-sm">{t("autoApprovalsUi.noSuspended")}</p>
          )}
          {suspended.map((s) => (
            <div
              key={s.sessionKey}
              className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <span className="flex flex-col">
                <span className="font-mono text-xs">{s.sessionKey}</span>
                <span>{s.reason}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label={t("autoApprovalsUi.resume", { session: s.sessionKey })}
                onClick={() => setResuming(s)}
              >
                {t("autoApprovalsUi.resumeConfirm")}
              </Button>
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-2">
          {loading && <LoadingState label={t("autoApprovalsUi.loading")} />}
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
        />
      )}
    </Page>
  );
}
