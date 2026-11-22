import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { ActionButton } from "@/shared/feedback/index.ts";
import { useBusy } from "@/shared/hooks/index.ts";
import { Form, FormActions, Inline } from "@/shared/layout/index.ts";
import type { SecretType } from "./vault";

const TYPES: SecretType[] = ["ssh-key", "password", "token", "env"];
/** A password or a token is one line a person types: it is hidden unless they ask to see it (#3942). */
const MASKED: ReadonlySet<SecretType> = new Set(["password", "token"]);

/** The text without the line breaks at its end: a scan from the end, linear however long the run. */
function withoutTrailingBreaks(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === "\n" || text[end - 1] === "\r")) end--;
  return text.slice(0, end);
}

const splitTags = (text: string): string[] =>
  text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

/** Creates a secret by hand, generates an SSH key, or imports a key file. */
export function NewSecretForm(
  props: Readonly<{
    store: AppStore;
    onClose(): void;
    /** The tags a new secret starts with: the selected client's vault tag (phase 29). */
    defaultTags?: string;
  }>,
) {
  const t = useT();
  const { store } = props;
  const id = useId();
  const [name, setName] = useState("");
  const [type, setType] = useState<SecretType>("password");
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const [tags, setTags] = useState(props.defaultTags ?? "");
  const [deleteOriginal, setDeleteOriginal] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  const save = async () => {
    const meta = await store.secrets.add({ name: name.trim(), type, value, tags: splitTags(tags) });
    if (meta) props.onClose();
  };

  const generate = async () => {
    const made = await store.secrets.generateKey({ name: name.trim(), tags: splitTags(tags) });
    if (!made) return;
    setPublicKey(made.publicKey);
    setName("");
  };

  const importFile = async () => {
    const meta = await store.secrets.importKeyFile({
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
          className="h-9 rounded-md border border-input bg-transparent px-2"
          value={type}
          onChange={(event) => {
            const next = event.target.value as SecretType;
            setType(next);
            setShown(false);
            // A one-line input drops the line breaks of what it shows but not of what we keep:
            // carrying a pasted key into it would save a different secret than the one on screen.
            // A break at the very end is a paste accident, so it goes; one inside empties the box.
            if (MASKED.has(next)) {
              const oneLine = withoutTrailingBreaks(value);
              setValue(/[\r\n]/.test(oneLine) ? "" : oneLine);
            }
          }}
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
        {MASKED.has(type) ? (
          <>
            <Input
              id={`${id}-value`}
              type={shown ? "text" : "password"}
              value={value}
              autoComplete="new-password"
              spellCheck={false}
              onChange={(event) => setValue(event.target.value)}
            />
            <Inline>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={shown}
                onClick={() => setShown(!shown)}
              >
                {t("vault.showValue")}
              </Button>
            </Inline>
          </>
        ) : (
          <Textarea
            id={`${id}-value`}
            value={value}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
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
          aria-describedby={`${id}-delete-hint`}
          onChange={(event) => setDeleteOriginal(event.target.checked)}
        />
        {t("vault.deleteOriginal")}
      </label>
      <p id={`${id}-delete-hint`} className="text-muted-foreground text-xs">
        {t("vault.deleteOriginalHint")}
      </p>
      {publicKey && (
        <div className="flex flex-col gap-1 text-sm">
          <span>{t("vault.publicKey")}</span>
          <code className="break-all rounded bg-muted p-2">{publicKey}</code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void store.system.copyText(publicKey)}
          >
            {t("vault.copyPublicKey")}
          </Button>
        </div>
      )}
      <FormActions
        submit={t("vault.save")}
        busy={saving.busy}
        disabled={!named || value === ""}
        disabledReason={t(named ? "vault.needValue" : "vault.needName")}
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
