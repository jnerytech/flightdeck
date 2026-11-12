import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConflictChoice } from "@/features/vault/index.ts";
import { useBusy } from "@/hooks/use-busy";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { Field, Form, FormActions, Panel, Stack } from "@/shared/layout/index.ts";
import type { RestorePreview } from "./backup-bundle.ts";

/** What a conflicting entry gets on restore: kept as it is, or replaced by the bundle's. */
const CHOICES = [
  ["skip", "backupAll.keep"],
  ["overwrite", "backupAll.replace"],
] as const satisfies ReadonlyArray<readonly [ConflictChoice, Key]>;
const KINDS = ["settings", "personas", "snippets", "hosts", "vault"] as const;

/** Issue #1241: back up everything to one encrypted file, and restore it with a preview. */
export function BackupAllPanel(props: Readonly<{ store: AppStore }>) {
  const t = useT();
  const id = useId();
  const { store } = props;
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [exportNote, setExportNote] = useState<{ tone: "info" | "error"; text: string } | null>(
    null,
  );
  const [filePassphrase, setFilePassphrase] = useState("");
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [choice, setChoice] = useState<ConflictChoice>("skip");
  const [importNote, setImportNote] = useState<{ tone: "info" | "error"; text: string } | null>(
    null,
  );
  const [replacing, setReplacing] = useState(false);
  // Issue #1462: where the backup to restore comes from. Drive is offered only with a client id.
  const scheduler = store.backupScheduler;
  useSyncExternalStore(scheduler.subscribe, () => scheduler.version);
  const [from, setFrom] = useState<"file" | "drive">("file");
  const [driveNames, setDriveNames] = useState<string[] | null>(null);
  const [driveName, setDriveName] = useState("");
  const looking = useBusy();
  const onDrive = scheduler.driveAvailable && from === "drive";
  const exportField = useRef<HTMLInputElement>(null);
  const importField = useRef<HTMLInputElement>(null);
  const exporting = useBusy();
  const reading = useBusy();
  const restoring = useBusy();

  const doExport = async () => {
    setExportNote(null);
    const outcome = await store.backup.create(passphrase, confirmation);
    if (outcome.ok) {
      setExportNote({ tone: "info", text: t("backupAll.saved") });
      setPassphrase("");
      setConfirmation("");
      exportField.current?.focus();
    } else if (outcome.code !== "cancelled") {
      setExportNote({ tone: "error", text: t(`backupAll.error.${outcome.code}`) });
    }
  };

  const doRead = async () => {
    setPreview(null);
    setImportNote(null);
    const outcome = onDrive
      ? await store.backup.previewDrive(driveName, filePassphrase)
      : await store.backup.preview(filePassphrase);
    if (outcome.ok) {
      setPreview(outcome.preview);
      setChoice("skip");
      // The decrypted bundle is held by the preview; the passphrase is not needed again.
      setFilePassphrase("");
    } else if (outcome.code !== "cancelled") {
      setImportNote({ tone: "error", text: t(`backupAll.error.${outcome.code}`) });
    }
  };

  const doLook = async () => {
    setImportNote(null);
    setPreview(null);
    const outcome = await store.backup.driveList();
    if (outcome.ok) {
      setDriveNames(outcome.names);
      setDriveName("");
    } else {
      setImportNote({ tone: "error", text: t(`backupAll.error.${outcome.code}`) });
    }
  };

  const doRestore = async () => {
    if (!preview) return;
    const outcome = await store.backup.restore(preview, choice);
    if (outcome.ok) {
      setImportNote({ tone: "info", text: t("backupAll.result", { ...outcome.result }) });
    } else {
      setImportNote({ tone: "error", text: t("backupAll.error.failed") });
    }
    // A preview applies once: it is gone either way, and the passphrase with it.
    setPreview(null);
    setFilePassphrase("");
    importField.current?.focus();
  };

  const differing = preview
    ? KINDS.flatMap((kind) => {
        const kindName = t(`backupAll.kinds.${kind}` as Key);
        return preview[kind].conflicting.map((name) => `${kindName}: ${name}`);
      })
    : [];
  // Only a new item, or a difference the person chose to replace, changes anything.
  const added = preview ? KINDS.reduce((sum, kind) => sum + preview[kind].added.length, 0) : 0;
  const replaced = choice === "overwrite" ? differing.length : 0;
  const changes = added + replaced;

  return (
    <Panel title={t("backupAll.title")}>
      <Stack gap={6}>
        <p className="text-muted-foreground text-sm">{t("backupAll.intro")}</p>
        <section aria-labelledby={`${id}-export`}>
          <Stack gap={4}>
            <h4 id={`${id}-export`} className="font-medium">
              {t("backupAll.exportTitle")}
            </h4>
            <Form variant="inline" onSubmit={() => exporting.run(doExport)}>
              <Field label={t("backupAll.passphrase")} help={t("backupAll.passphraseHelp")}>
                {(control) => (
                  <Input
                    {...control}
                    ref={exportField}
                    type="password"
                    autoComplete="off"
                    value={passphrase}
                    onChange={(event) => {
                      setPassphrase(event.target.value);
                      setExportNote(null);
                    }}
                  />
                )}
              </Field>
              <Field label={t("backupAll.confirm")}>
                {(control) => (
                  <Input
                    {...control}
                    type="password"
                    autoComplete="off"
                    value={confirmation}
                    onChange={(event) => {
                      setConfirmation(event.target.value);
                      setExportNote(null);
                    }}
                  />
                )}
              </Field>
              <FormActions
                submit={t("backupAll.export")}
                busy={exporting.busy}
                disabled={passphrase === "" || confirmation === ""}
                disabledReason={t("backupAll.exportNeeds")}
              />
            </Form>
            {exportNote && <InlineNotice tone={exportNote.tone}>{exportNote.text}</InlineNotice>}
          </Stack>
        </section>

        <section aria-labelledby={`${id}-import`}>
          <Stack gap={4}>
            <h4 id={`${id}-import`} className="font-medium">
              {t("backupAll.importTitle")}
            </h4>
            {scheduler.driveAvailable && store.canReadBackup() && (
              <fieldset>
                <legend className="sr-only">{t("backupAll.sourceLegend")}</legend>
                <Stack gap={1}>
                  {(["file", "drive"] as const).map((one) => (
                    <label key={one} className="flex items-center gap-2">
                      <input
                        type="radio"
                        className="hit-control"
                        name={`${id}-from`}
                        checked={from === one}
                        disabled={reading.busy}
                        onChange={() => {
                          setFrom(one);
                          setImportNote(null);
                          setPreview(null);
                        }}
                      />
                      {t(`backupAll.source.${one}`)}
                    </label>
                  ))}
                </Stack>
              </fieldset>
            )}
            {onDrive && !scheduler.driveSignedIn && (
              <InlineNotice tone="warn">{t("backupAll.driveNeedsSignIn")}</InlineNotice>
            )}
            {onDrive && scheduler.driveSignedIn && (
              <Stack gap={2}>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={looking.busy}
                    onClick={() => looking.run(doLook)}
                  >
                    {t("backupAll.driveLook")}
                  </Button>
                </div>
                {driveNames?.length === 0 && (
                  <p className="text-muted-foreground text-sm">{t("backupAll.driveNone")}</p>
                )}
                {driveNames && driveNames.length > 0 && (
                  <fieldset>
                    <legend className="sr-only">{t("backupAll.driveChoiceLegend")}</legend>
                    <Stack gap={1}>
                      {driveNames.map((name) => (
                        <label key={name} className="flex items-center gap-2">
                          <input
                            type="radio"
                            className="hit-control"
                            name={`${id}-drive`}
                            checked={driveName === name}
                            disabled={reading.busy}
                            onChange={() => {
                              setDriveName(name);
                              setPreview(null);
                              setImportNote(null);
                            }}
                          />
                          {name}
                        </label>
                      ))}
                    </Stack>
                  </fieldset>
                )}
              </Stack>
            )}
            {store.canReadBackup() ? (
              (!onDrive || scheduler.driveSignedIn) && (
                <Form variant="inline" onSubmit={() => reading.run(doRead)}>
                  <Field label={t("backupAll.filePassphrase")}>
                    {(control) => (
                      <Input
                        {...control}
                        ref={importField}
                        type="password"
                        autoComplete="off"
                        value={filePassphrase}
                        onChange={(event) => {
                          setFilePassphrase(event.target.value);
                          setImportNote(null);
                        }}
                      />
                    )}
                  </Field>
                  <FormActions
                    submit={t("backupAll.read")}
                    busy={reading.busy}
                    disabled={filePassphrase === "" || (onDrive && driveName === "")}
                    disabledReason={
                      onDrive ? t("backupAll.driveReadNeeds") : t("backupAll.readNeeds")
                    }
                  />
                </Form>
              )
            ) : (
              <p className="text-muted-foreground text-sm">{t("backupAll.needsDesktop")}</p>
            )}
            {preview && (
              <Form
                variant="inline"
                onSubmit={() =>
                  differing.length > 0 && choice === "overwrite"
                    ? setReplacing(true)
                    : restoring.run(doRestore)
                }
              >
                <Stack gap={1}>
                  {KINDS.map((kind) => (
                    <p key={kind}>
                      {t("backupAll.line", {
                        kind: t(`backupAll.kinds.${kind}` as Key),
                        added: preview[kind].added.length,
                        same: preview[kind].same.length,
                        conflicting: preview[kind].conflicting.length,
                      })}
                    </p>
                  ))}
                </Stack>
                {preview.hosts.added.length > 0 && (
                  // A host brings its address and token: name each one before it is added.
                  <Stack as="ul" gap={1} label={t("backupAll.newHosts")}>
                    {preview.hosts.added.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </Stack>
                )}
                {differing.length > 0 && (
                  <>
                    <Stack as="ul" gap={1} label={t("backupAll.conflictList")}>
                      {differing.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </Stack>
                    <fieldset>
                      <legend className="sr-only">{t("backupAll.choiceLegend")}</legend>
                      <Stack gap={1}>
                        {CHOICES.map(([value, label]) => (
                          <label key={value} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`${id}-choice`}
                              checked={choice === value}
                              onChange={() => setChoice(value)}
                            />
                            {t(label)}
                          </label>
                        ))}
                      </Stack>
                    </fieldset>
                  </>
                )}
                <FormActions
                  submit={t("backupAll.restore")}
                  busy={restoring.busy}
                  disabled={changes === 0}
                  disabledReason={t("backupAll.nothingToRestore")}
                />
              </Form>
            )}
            {importNote && <InlineNotice tone={importNote.tone}>{importNote.text}</InlineNotice>}
          </Stack>
        </section>
        {replacing && preview && (
          <ConfirmDialog
            message={t("backupAll.replaceMessage", { names: differing.join(", ") })}
            confirmLabel={t("backupAll.replaceConfirm")}
            destructive
            onConfirm={() => {
              setReplacing(false);
              restoring.run(doRestore);
            }}
            onCancel={() => setReplacing(false)}
          />
        )}
      </Stack>
    </Panel>
  );
}
