import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
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
    <div className="flex flex-col gap-6">
      <section className="flex max-w-md flex-col gap-3">
        <h2 className="font-medium">{t("vault.backup.exportTitle")}</h2>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={`${id}-pass`}>{t("vault.backup.passphrase")}</label>
          <Input
            id={`${id}-pass`}
            type="password"
            autoComplete="off"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={`${id}-confirm`}>{t("vault.backup.confirm")}</label>
          <Input
            id={`${id}-confirm`}
            type="password"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        <Button className="self-start" onClick={() => void doExport()}>
          {t("vault.backup.export")}
        </Button>
        {exportMessage && <p role="status">{exportMessage}</p>}
      </section>

      <section className="flex max-w-md flex-col gap-3">
        <h2 className="font-medium">{t("vault.backup.importTitle")}</h2>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={`${id}-file-pass`}>{t("vault.backup.filePassphrase")}</label>
          <Input
            id={`${id}-file-pass`}
            type="password"
            autoComplete="off"
            value={filePassphrase}
            onChange={(event) => setFilePassphrase(event.target.value)}
          />
        </div>
        <Button className="self-start" variant="outline" onClick={() => void doPreview()}>
          {t("vault.backup.import")}
        </Button>
        {preview && (
          <div className="flex flex-col gap-2 text-sm">
            <p>{t("vault.backup.added", { n: preview.added.length })}</p>
            <p>{t("vault.backup.same", { n: preview.same.length })}</p>
            <p>{t("vault.backup.conflicting", { n: preview.conflicting.length })}</p>
            {preview.conflicting.length > 0 && (
              <fieldset className="flex flex-col gap-1">
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
              </fieldset>
            )}
            <Button className="self-start" onClick={() => void doApply()}>
              {t("vault.backup.apply")}
            </Button>
          </div>
        )}
        {importMessage && <p role="status">{importMessage}</p>}
      </section>
    </div>
  );
}
