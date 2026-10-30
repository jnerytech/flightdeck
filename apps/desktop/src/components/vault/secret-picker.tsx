import { useT } from "@/i18n/context";
import type { SecretMeta, SecretType } from "@/lib/vault";

export interface SecretPickerProps {
  /** The vault's list (`Vault.list()`): metadata only, never a value. */
  secrets: SecretMeta[];
  /** The chosen secret's id; "" for none. */
  value: string;
  /** The new id; "" when the choice is cleared. */
  onChange: (id: string) => void;
  /** Shows only secrets of these types. */
  types?: SecretType[];
  label: string;
}

/** Picks a secret by id. It only ever sees metadata, so no value can reach the screen. */
export function SecretPicker(props: SecretPickerProps) {
  const t = useT();
  const shown = props.types
    ? props.secrets.filter((s) => props.types?.includes(s.type))
    : props.secrets;
  return (
    <select
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30"
    >
      <option value="">{t("vault.picker.none")}</option>
      {shown.map((s) => (
        <option key={s.id} value={s.id}>
          {s.tags.length ? `${s.name} · ${s.tags.join(", ")}` : s.name}
        </option>
      ))}
    </select>
  );
}
