import { useId, useState, useSyncExternalStore } from "react";
import { Field, Form, FormActions } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBusy } from "@/hooks/use-busy";
import { useT } from "@/i18n/context";
import { formatDateTime } from "@/i18n/format";
import type { AppStore } from "@/lib/app-store";
import type { Cadence, ScheduleTarget } from "@/lib/backup-schedule";
import { InlineNotice } from "@/shared/feedback/index.ts";

const CADENCES: readonly Cadence[] = ["off", "daily", "weekly"];
const TARGETS: readonly ScheduleTarget[] = ["folder", "drive"];
/** The number of files to keep that `text` means, or null when it is not a whole number from 1. */
function validKeep(text: string): number | null {
  const keep = Number(text);
  return text.trim() !== "" && Number.isInteger(keep) && keep >= 1 ? keep : null;
}

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
  const signing = useBusy();
  const [refused, setRefused] = useState(false);
  if (!scheduler.supported) return null;

  const schedule = scheduler.schedule();
  const report = scheduler.report;
  // #1329: what was typed stays, and says why it is not saved, until it is a whole number from 1.
  const keepValid = validKeep(keepText) !== null;
  const waiting = schedule.cadence !== "off" && !scheduler.hasPassphrase;
  // Drive is a choice only where a client id is configured; a saved Drive target means the folder without it.
  const onDrive = scheduler.driveAvailable && schedule.target === "drive";

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
                  className="hit-control"
                  name={`${id}-cadence`}
                  checked={schedule.cadence === cadence}
                  onChange={() => void scheduler.setCadence(cadence)}
                />
                {t(`backupSchedule.cadence.${cadence}`)}
              </label>
            ))}
          </Stack>
        </fieldset>
        {scheduler.driveAvailable && (
          <fieldset>
            <legend className="sr-only">{t("backupSchedule.targetLegend")}</legend>
            <Stack gap={1}>
              {TARGETS.map((target) => (
                <label key={target} className="flex items-center gap-2">
                  <input
                    type="radio"
                    className="hit-control"
                    name={`${id}-target`}
                    checked={schedule.target === target}
                    onChange={() => scheduler.setTarget(target)}
                  />
                  {t(`backupSchedule.target.${target}`)}
                </label>
              ))}
            </Stack>
          </fieldset>
        )}
        {onDrive ? (
          <Stack gap={1}>
            <p className="text-muted-foreground text-sm">{t("backupSchedule.driveHelp")}</p>
            <p>
              {scheduler.driveSignedIn
                ? t("backupSchedule.driveSignedIn")
                : t("backupSchedule.driveSignedOut")}
            </p>
            {refused && <InlineNotice tone="warn">{t("backupSchedule.driveRefused")}</InlineNotice>}
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={signing.busy}
                onClick={() =>
                  signing.run(async () => {
                    if (scheduler.driveSignedIn) {
                      setRefused(false);
                      await scheduler.signOutDrive();
                      return;
                    }
                    setRefused((await scheduler.signInDrive()) === "refused");
                  })
                }
              >
                {scheduler.driveSignedIn
                  ? t("backupSchedule.driveSignOut")
                  : t("backupSchedule.driveSignIn")}
              </Button>
            </div>
          </Stack>
        ) : (
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
        )}
        <Form variant="inline" onSubmit={() => {}}>
          <Field
            label={t("backupSchedule.keep")}
            error={
              keepValid
                ? undefined
                : t("backupSchedule.keepInvalid", { count: String(schedule.keep) })
            }
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                min={1}
                value={keepText}
                onChange={(event) => {
                  setKeepText(event.target.value);
                  const keep = validKeep(event.target.value);
                  if (keep !== null) scheduler.setKeep(keep);
                }}
              />
            )}
          </Field>
        </Form>
        {/* Before the passphrase field: the waiting notice says "Type it below". */}
        {report.status === "skipped" && (
          <InlineNotice tone={report.reason === "failed" ? "error" : "warn"}>
            {t(`backupSchedule.skipped.${report.reason}`)}
          </InlineNotice>
        )}
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
