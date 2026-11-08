import { useId, useState, useSyncExternalStore } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Field, Form, FormActions } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBusy } from "@/hooks/use-busy";
import { useT } from "@/i18n/context";
import { formatDateTime } from "@/i18n/format";
import type { AppStore } from "@/lib/app-store";
import type { Cadence } from "@/lib/backup-schedule";

const CADENCES: readonly Cadence[] = ["off", "daily", "weekly"];
/** The same floor as a backup file's passphrase (the bundle refuses a shorter one). */
const MIN_PASSPHRASE = 12;

/** Issue #1264: Settings > Backup schedule. The desktop app only: a browser cannot write to a folder. */
export function BackupSchedulePanel(props: Readonly<{ store: AppStore }>) {
  const scheduler = props.store.backupScheduler;
  const t = useT();
  const id = useId();
  useSyncExternalStore(scheduler.subscribe, () => scheduler.version);
  const [passphrase, setPassphrase] = useState("");
  const [keepText, setKeepText] = useState(String(scheduler.schedule().keep));
  const choosing = useBusy();
  const using = useBusy();
  if (!scheduler.supported) return null;

  const schedule = scheduler.schedule();
  const report = scheduler.report;
  const waiting = schedule.cadence !== "off" && !scheduler.hasPassphrase;

  return (
    <Panel title={t("backupSchedule.title")}>
      <Stack gap={4}>
        <p className="text-muted-foreground text-sm">{t("backupSchedule.intro")}</p>
        <fieldset>
          <legend className="sr-only">{t("backupSchedule.cadenceLegend")}</legend>
          <Stack gap={1}>
            {CADENCES.map((cadence) => (
              <label key={cadence} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-cadence`}
                  checked={schedule.cadence === cadence}
                  onChange={() => void scheduler.setCadence(cadence)}
                />
                {t(`backupSchedule.cadence.${cadence}`)}
              </label>
            ))}
          </Stack>
        </fieldset>
        <Stack gap={1}>
          <p>
            <span className="font-medium">{t("backupSchedule.folder")}: </span>
            {scheduler.folder ?? t("backupSchedule.noFolder")}
          </p>
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={choosing.busy}
              onClick={() => choosing.run(() => scheduler.chooseFolder())}
            >
              {t("backupSchedule.chooseFolder")}
            </Button>
          </div>
        </Stack>
        <Form variant="inline" onSubmit={() => {}}>
          <Field label={t("backupSchedule.keep")}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={1}
                value={keepText}
                onBlur={() => setKeepText(String(scheduler.schedule().keep))}
                onChange={(event) => {
                  setKeepText(event.target.value);
                  const keep = Number(event.target.value);
                  if (Number.isInteger(keep) && keep >= 1) void scheduler.setKeep(keep);
                }}
              />
            )}
          </Field>
        </Form>
        {waiting && (
          <Form
            variant="inline"
            onSubmit={() =>
              using.run(async () => {
                const given = passphrase;
                setPassphrase("");
                await scheduler.setPassphrase(given);
              })
            }
          >
            <Field label={t("backupSchedule.passphrase")} help={t("backupSchedule.passphraseHelp")}>
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="off"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                />
              )}
            </Field>
            <FormActions
              submit={t("backupSchedule.usePassphrase")}
              busy={using.busy}
              disabled={passphrase.length < MIN_PASSPHRASE}
              disabledReason={t("backupSchedule.passphraseNeeds")}
            />
          </Form>
        )}
        {schedule.cadence !== "off" && scheduler.hasPassphrase && (
          <p className="text-muted-foreground text-sm">{t("backupSchedule.passphraseSet")}</p>
        )}
        {report.status === "skipped" && (
          <InlineNotice tone={report.reason === "failed" ? "error" : "warn"}>
            {t(`backupSchedule.skipped.${report.reason}`)}
          </InlineNotice>
        )}
        {report.status === "done" && report.prune === "failed" && (
          <InlineNotice tone="warn">{t("backupSchedule.pruneFailed")}</InlineNotice>
        )}
        <p className="text-muted-foreground text-sm">
          {schedule.lastRunAt === null
            ? t("backupSchedule.neverRun")
            : t("backupSchedule.lastRun", {
                when: formatDateTime(new Date(schedule.lastRunAt).toISOString(), t.lang),
              })}
        </p>
      </Stack>
    </Panel>
  );
}
