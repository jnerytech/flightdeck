import { useId, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Form, FormActions } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useBusy } from "@/hooks/use-busy";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import type { SecretType } from "@/lib/vault";

const TYPES: SecretType[] = ["ssh-key", "password", "token", "env"];

const splitTags = (text: string): string[] =>
  text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

/** Creates a secret by hand, generates an SSH key, or imports a key file. */
export function NewSecretForm(props: {
  store: AppStore;
  onClose(): void;
  /** The tags a new secret starts with: the selected client's vault tag (phase 29). */
  defaultTags?: string;
}) {
  const t = useT();
  const { store } = props;
  const id = useId();
  const [name, setName] = useState("");
  const [type, setType] = useState<SecretType>("password");
  const [value, setValue] = useState("");
  const [tags, setTags] = useState(props.defaultTags ?? "");
  const [deleteOriginal, setDeleteOriginal] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  const save = async () => {
    await store.addSecret({ name: name.trim(), type, value, tags: splitTags(tags) });
    props.onClose();
  };

  const generate = async () => {
    const made = await store.generateSshKey({ name: name.trim(), tags: splitTags(tags) });
    if (!made) return;
    setPublicKey(made.publicKey);
    setName("");
  };

  const importFile = async () => {
    const meta = await store.importKeyFile({
      name: name.trim(),
      tags: splitTags(tags),
      deleteOriginal,
    });
    if (meta) props.onClose();
  };

  const saving = useBusy();
  const named = name.trim() !== "";
  return (
    <Form
      variant="panel"
      className="mb-4"
      onSubmit={() => {
        if (named && value !== "") saving.run(save);
      }}
    >
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${id}-name`}>{t("vault.name")}</label>
        <Input
          id={`${id}-name`}
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        {t("vault.typeLabel")}
        <select
          className="h-9 rounded-md border bg-transparent px-2"
          value={type}
          onChange={(event) => setType(event.target.value as SecretType)}
        >
          {TYPES.map((option) => (
            <option key={option} value={option}>
              {t(`vault.type.${option}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${id}-value`}>{t("vault.value")}</label>
        <Textarea
          id={`${id}-value`}
          value={value}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${id}-tags`}>{t("vault.tags")}</label>
        <Input
          id={`${id}-tags`}
          value={tags}
          autoComplete="off"
          onChange={(event) => setTags(event.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={deleteOriginal}
          onChange={(event) => setDeleteOriginal(event.target.checked)}
        />
        {t("vault.deleteOriginal")}
      </label>
      {publicKey && (
        <div className="flex flex-col gap-1 text-sm">
          <span>{t("vault.publicKey")}</span>
          <code className="break-all rounded bg-muted p-2">{publicKey}</code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void store.copyText(publicKey)}
          >
            {t("vault.copyPublicKey")}
          </Button>
        </div>
      )}
      <FormActions
        submit={t("vault.save")}
        busy={saving.busy}
        disabled={!named || value === ""}
        cancel={t("common.cancel")}
        onCancel={props.onClose}
        extra={
          <>
            <ActionButton
              type="button"
              variant="outline"
              disabled={!named}
              onClick={() => generate()}
            >
              {t("vault.generate")}
            </ActionButton>
            <ActionButton
              type="button"
              variant="outline"
              disabled={!named}
              onClick={() => importFile()}
            >
              {t("vault.importFile")}
            </ActionButton>
          </>
        }
      />
    </Form>
  );
}
