import { useId, useRef, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Field, Form, FormActions } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import { Input } from "@/components/ui/input";
import { useBusy } from "@/hooks/use-busy";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import type { RestorePreview } from "@/lib/backup-bundle";
import type { ConflictChoice } from "@/lib/vault-backup";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

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
  const exportField = useRef<HTMLInputElement>(null);
  const importField = useRef<HTMLInputElement>(null);
  const exporting = useBusy();
  const reading = useBusy();
  const restoring = useBusy();

  const doExport = async () => {
    setExportNote(null);
    const outcome = await store.backupEverything(passphrase, confirmation);
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
    const outcome = await store.previewBackup(filePassphrase);
    if (outcome.ok) {
      setPreview(outcome.preview);
      setChoice("skip");
    } else if (outcome.code !== "cancelled") {
      setImportNote({ tone: "error", text: t(`backupAll.error.${outcome.code}`) });
    }
  };

  const doRestore = async () => {
    if (!preview) return;
    const outcome = await store.restoreBackup(preview, choice);
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
    ? KINDS.flatMap((kind) =>
        preview[kind].conflicting.map((name) => `${t(`backupAll.kinds.${kind}` as Key)}: ${name}`),
      )
    : [];
  // Only a new item, or a difference the person chose to replace, changes anything.
  const changes = preview
    ? KINDS.reduce((sum, kind) => sum + preview[kind].added.length, 0) +
      (choice === "overwrite" ? differing.length : 0)
    : 0;

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
                disabled={filePassphrase === ""}
                disabledReason={t("backupAll.readNeeds")}
              />
            </Form>
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
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`${id}-choice`}
                            checked={choice === "skip"}
                            onChange={() => setChoice("skip")}
                          />
                          {t("backupAll.keep")}
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`${id}-choice`}
                            checked={choice === "overwrite"}
                            onChange={() => setChoice("overwrite")}
                          />
                          {t("backupAll.replace")}
                        </label>
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
