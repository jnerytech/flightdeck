import type { DoctorResult } from "@flightdeck/protocol";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import { APP_VERSION } from "@/lib/version";

/** The host's self-check: each item with a plain step to fix it when it failed. */
export function HostDoctor(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  const [result, setResult] = useState<DoctorResult | null>(null);
  const run = async () => {
    const report = await store.hostCommand(host.id, "doctor.run", { appVersion: APP_VERSION });
    if (report) setResult(report);
  };
  const attention = result?.checks.filter((check) => check.status !== "ok").length ?? 0;
  return (
    <Panel title={t("doctor.title")}>
      <p className="text-muted-foreground text-xs">{t("doctor.hint")}</p>
      <div>
        <ActionButton variant="outline" onClick={run}>
          {t("doctor.run")}
        </ActionButton>
      </div>
      {result && (
        <>
          <p role="status" className="text-sm">
            {attention === 0 ? t("doctor.allGood") : t("doctor.problems", { n: attention })}
          </p>
          <ul aria-label={t("doctor.results")} className="check-list">
            {result.checks.map((check) => (
              <li key={check.id} className="check-row">
                <span className="check-line">
                  <strong>{t(`doctor.check.${check.id}`)}</strong>
                  <span>{t(`doctor.status.${check.status}`)}</span>
                  {check.status === "ok" && (
                    <code className="font-mono text-muted-foreground text-xs">{check.detail}</code>
                  )}
                </span>
                {check.status !== "ok" && (
                  <span className="text-sm">
                    {t("doctor.fix", { step: t(`doctor.steps.${check.id}`) })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
