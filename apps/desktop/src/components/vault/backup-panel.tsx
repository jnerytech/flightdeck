import { useId, useState } from "react";
import { Field, Form, FormActions } from "@/components/layout/form";
import { Stack } from "@/components/layout/stack";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import type { ConflictChoice, ImportPreview } from "@/lib/vault-backup";

/** Phase 16: the encrypted backup (`.fdvault`): export, and import with a preview. */
export function BackupPanel(props: { store: AppStore }) {
  const t = useT();
  const id = useId();
  const { store } = props;
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [filePassphrase, setFilePassphrase] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choice, setChoice] = useState<ConflictChoice>("skip");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  /** Shows a form as busy while its work runs, so a click is never left without an answer. */
  const run = async (busy: (on: boolean) => void, work: () => Promise<void>) => {
    busy(true);
    try {
      await work();
    } finally {
      busy(false);
    }
  };

  const doExport = async () => {
    const outcome = await store.exportVault(passphrase, confirmation);
    if (outcome.ok) {
      setExportMessage(t("vault.backup.exported"));
      setPassphrase("");
      setConfirmation("");
    } else {
      setExportMessage(
        outcome.code === "cancelled" ? null : t(`vault.backup.error.${outcome.code}`),
      );
    }
  };

  const doPreview = async () => {
    setPreview(null);
    setImportMessage(null);
    const outcome = await store.previewVaultImport(filePassphrase);
    if (outcome.ok) {
      setPreview(outcome.preview);
      setChoice("skip");
    } else if (outcome.code !== "cancelled") {
      setImportMessage(t(`vault.backup.error.${outcome.code}`));
    }
  };

  const doApply = async () => {
    if (!preview) return;
    const result = await store.applyVaultImport(preview, choice);
    setPreview(null);
    setFilePassphrase("");
    setImportMessage(
      t("vault.backup.result", {
        added: result.added,
        overwritten: result.overwritten,
        skipped: result.skipped,
      }),
    );
  };

  return (
    <Stack gap={6}>
      <section aria-labelledby={`${id}-export`}>
        <Stack gap={4}>
          <h2 id={`${id}-export`} className="font-medium">
            {t("vault.backup.exportTitle")}
          </h2>
          <Form variant="page" onSubmit={() => void run(setExporting, doExport)}>
            <Field label={t("vault.backup.passphrase")} help={t("vault.backup.passphraseHelp")}>
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
            <Field label={t("vault.backup.confirm")}>
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              )}
            </Field>
            <FormActions
              submit={t("vault.backup.export")}
              busy={exporting}
              disabled={passphrase === "" || confirmation === ""}
              disabledReason={t("vault.backup.exportNeeds")}
            />
            {exportMessage && <p role="status">{exportMessage}</p>}
          </Form>
        </Stack>
      </section>

      <section aria-labelledby={`${id}-import`}>
        <Stack gap={4}>
          <h2 id={`${id}-import`} className="font-medium">
            {t("vault.backup.importTitle")}
          </h2>
          <Form variant="page" onSubmit={() => void run(setImporting, doPreview)}>
            <Field label={t("vault.backup.filePassphrase")}>
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="off"
                  value={filePassphrase}
                  onChange={(event) => setFilePassphrase(event.target.value)}
                />
              )}
            </Field>
            <FormActions
              submit={t("vault.backup.import")}
              busy={importing}
              disabled={filePassphrase === ""}
              disabledReason={t("vault.backup.importNeeds")}
            />
          </Form>
          {preview && (
            <Form variant="page" onSubmit={() => void doApply()}>
              <Stack gap={1}>
                <p>{t("vault.backup.added", { n: preview.added.length })}</p>
                <p>{t("vault.backup.same", { n: preview.same.length })}</p>
                <p>{t("vault.backup.conflicting", { n: preview.conflicting.length })}</p>
              </Stack>
              {preview.conflicting.length > 0 && (
                <fieldset>
                  <Stack gap={1}>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`${id}-choice`}
                        checked={choice === "skip"}
                        onChange={() => setChoice("skip")}
                      />
                      {t("vault.backup.keep")}
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`${id}-choice`}
                        checked={choice === "overwrite"}
                        onChange={() => setChoice("overwrite")}
                      />
                      {t("vault.backup.replace")}
                    </label>
                  </Stack>
                </fieldset>
              )}
              <FormActions submit={t("vault.backup.apply")} />
            </Form>
          )}
          {importMessage && <p role="status">{importMessage}</p>}
        </Stack>
      </section>
    </Stack>
  );
}
