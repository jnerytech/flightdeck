import type { PermissionMode } from "@flightdeck/protocol";
import { Field, NativeSelect } from "@/components/layout/form";
import { useT } from "@/i18n/context";

/** A mode picked, or "" for the default. */
export type PermissionChoice = PermissionMode | "";

/** What a team member can open in; Bypass only where the host allows it (issue #93). */
const MODES: readonly PermissionMode[] = ["acceptEdits", "plan"];

/** A choice of permission mode; "" is the default (Ask before changes, or the persona's own, if stricter). */
export function PermissionSelect(
  props: Readonly<{
    label: string;
    value: PermissionChoice;
    allowBypass: boolean;
    onChange(value: PermissionChoice): void;
  }>,
) {
  const t = useT();
  const modes = props.allowBypass ? [...MODES, "bypassPermissions" as const] : MODES;
  return (
    <Field label={props.label}>
      {(control) => (
        <NativeSelect
          {...control}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value as PermissionChoice)}
        >
          <option value="">{t("modes.default.name")}</option>
          {modes.map((mode) => (
            <option key={mode} value={mode}>
              {t(`modes.${mode}.name`)}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}
