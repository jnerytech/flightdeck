import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppState, AppStore } from "@/lib/app-store";
import type { SecretMeta } from "@/lib/vault";

/** Edits what a secret is called and where it may go; the value is never loaded here. */
export function EditSecretForm(props: {
  store: AppStore;
  state: AppState;
  secret: SecretMeta;
  onClose(): void;
}) {
  const t = useT();
  const id = useId();
  const { store, state, secret } = props;
  const [name, setName] = useState(secret.name);
  const [description, setDescription] = useState(secret.description);
  const [tags, setTags] = useState(secret.tags.join(", "));
  const [allowed, setAllowed] = useState(secret.allowedHosts);

  const toggle = (hostId: string, on: boolean) =>
    setAllowed((list) => (on ? [...list, hostId] : list.filter((h) => h !== hostId)));

  const save = () => {
    store.updateSecret(secret.id, {
      name: name.trim(),
      description,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      allowedHosts: allowed,
    });
    props.onClose();
  };

  return (
    <form
      className="mb-4 flex flex-col gap-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() !== "") save();
      }}
    >
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${id}-name`}>{t("vault.name")}</label>
        <Input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${id}-description`}>{t("vault.description")}</label>
        <Input
          id={`${id}-description`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${id}-tags`}>{t("vault.tags")}</label>
        <Input id={`${id}-tags`} value={tags} onChange={(event) => setTags(event.target.value)} />
      </div>
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend>{t("vault.hostsLegend")}</legend>
        {state.hosts.map((host) => (
          <label key={host.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allowed.includes(host.id)}
              onChange={(event) => toggle(host.id, event.target.checked)}
            />
            {host.name}
          </label>
        ))}
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" disabled={name.trim() === ""}>
          {t("vault.editSave")}
        </Button>
        <Button type="button" variant="ghost" onClick={props.onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
