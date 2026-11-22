import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { useBusy } from "@/shared/hooks/index.ts";
import { Field, Form, FormActions, Stack } from "@/shared/layout/index.ts";
import type { ConflictChoice, ImportPreview } from "./domain/vault-backup.ts";

type Note = { tone: "info" | "error"; text: string };

/** Phase 16: the encrypted backup (`.fdvault`): export, and import with a preview. */
export function BackupPanel(props: Readonly<{ store: AppStore }>) {
  const t = useT();
  const id = useId();
  const { store } = props;
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [exportNote, setExportNote] = useState<Note | null>(null);
  const [filePassphrase, setFilePassphrase] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choice, setChoice] = useState<ConflictChoice>("skip");
  const [importNote, setImportNote] = useState<Note | null>(null);
  const [replacing, setReplacing] = useState(false);
  const exporting = useBusy();
  const importing = useBusy();
  const applying = useBusy();
  const importField = useRef<HTMLInputElement>(null);
  const previewBox = useRef<HTMLElement>(null);

  const doExport = async () => {
    const outcome = await store.secrets.exportFile(passphrase, confirmation);
    if (outcome.ok) {
      setExportNote({ tone: "info", text: t("vault.backup.exported") });
      setPassphrase("");
      setConfirmation("");
    } else if (outcome.code !== "cancelled") {
      setExportNote({ tone: "error", text: t(`vault.backup.error.${outcome.code}`) });
    } else {
      setExportNote(null);
    }
  };

  const doPreview = async () => {
    setPreview(null);
    setImportNote(null);
    const outcome = await store.secrets.previewImport(filePassphrase);
    if (outcome.ok) {
      setPreview(outcome.preview);
      setChoice("skip");
    } else if (outcome.code !== "cancelled") {
      setImportNote({ tone: "error", text: t(`vault.backup.error.${outcome.code}`) });
    }
  };

  const doApply = async () => {
    if (!preview) return;
    try {
      const result = await store.secrets.applyImport(preview, choice);
      setImportNote({
        tone: "info",
        text: t("vault.backup.result", {
          added: result.added,
          overwritten: result.overwritten,
          skipped: result.skipped,
        }),
      });
    } catch {
      // Secrets are restored one by one: some may be in already, so the notice says to look.
      setImportNote({ tone: "error", text: t("vault.backup.error.failed") });
    }
    // A preview applies once: it is gone either way, and the passphrase with it.
    setPreview(null);
    setFilePassphrase("");
    importField.current?.focus();
  };

  // The passphrase field is empty now and the preview mounts below it; take the person there.
  const previewShown = preview !== null;
  useEffect(() => {
    if (previewShown) previewBox.current?.focus();
  }, [previewShown]);

  return (
    <Stack gap={6}>
      <section aria-labelledby={`${id}-export`}>
        <Stack gap={4}>
          <h2 id={`${id}-export`} className="font-medium">
            {t("vault.backup.exportTitle")}
          </h2>
          <Form variant="page" onSubmit={() => exporting.run(doExport)}>
            <Field label={t("vault.backup.passphrase")} help={t("vault.backup.passphraseHelp")}>
              {(control) => (
                <Input
                  {...control}
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
            <Field label={t("vault.backup.confirm")}>
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
              submit={t("vault.backup.export")}
              busy={exporting.busy}
              disabled={passphrase === "" || confirmation === ""}
              disabledReason={t("vault.backup.exportNeeds")}
            />
            {exportNote && <InlineNotice tone={exportNote.tone}>{exportNote.text}</InlineNotice>}
          </Form>
        </Stack>
      </section>

      <section aria-labelledby={`${id}-import`}>
        <Stack gap={4}>
          <h2 id={`${id}-import`} className="font-medium">
            {t("vault.backup.importTitle")}
          </h2>
          <Form variant="page" onSubmit={() => importing.run(doPreview)}>
            <Field label={t("vault.backup.filePassphrase")}>
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
              submit={t("vault.backup.import")}
              busy={importing.busy}
              disabled={filePassphrase === ""}
              disabledReason={t("vault.backup.importNeeds")}
            />
          </Form>
          {preview && (
            <section
              ref={previewBox}
              aria-label={t("vault.backup.previewTitle")}
              tabIndex={-1}
              className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Form
                variant="page"
                onSubmit={() =>
                  preview.conflicting.length > 0 && choice === "overwrite"
                    ? setReplacing(true)
                    : applying.run(doApply)
                }
              >
                <Stack gap={1}>
                  <p>{t("vault.backup.added", { n: preview.added.length })}</p>
                  <p>{t("vault.backup.same", { n: preview.same.length })}</p>
                  <p>{t("vault.backup.conflicting", { n: preview.conflicting.length })}</p>
                </Stack>
                {preview.conflicting.length > 0 && (
                  <Stack as="ul" gap={1} label={t("vault.backup.conflictList")}>
                    {preview.conflicting.map((entry) => (
                      <li key={entry.meta.id} className="[overflow-wrap:anywhere]">
                        {entry.meta.name}
                      </li>
                    ))}
                  </Stack>
                )}
                {preview.conflicting.length > 0 && (
                  <fieldset>
                    <legend className="sr-only">{t("vault.backup.choiceLegend")}</legend>
                    <Stack gap={1}>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          className="hit-control"
                          name={`${id}-choice`}
                          checked={choice === "skip"}
                          onChange={() => setChoice("skip")}
                        />
                        {t("vault.backup.keep")}
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          className="hit-control"
                          name={`${id}-choice`}
                          checked={choice === "overwrite"}
                          onChange={() => setChoice("overwrite")}
                        />
                        {t("vault.backup.replace")}
                      </label>
                    </Stack>
                  </fieldset>
                )}
                <FormActions submit={t("vault.backup.apply")} busy={applying.busy} />
              </Form>
            </section>
          )}
          {importNote && <InlineNotice tone={importNote.tone}>{importNote.text}</InlineNotice>}
        </Stack>
      </section>
      {replacing && preview && (
        <ConfirmDialog
          message={t("vault.backup.replaceMessage", {
            names: preview.conflicting.map((entry) => entry.meta.name).join(", "),
          })}
          confirmLabel={t("vault.backup.replaceConfirm")}
          destructive
          onConfirm={() => {
            setReplacing(false);
            applying.run(doApply);
          }}
          onCancel={() => setReplacing(false)}
        />
      )}
    </Stack>
  );
}
