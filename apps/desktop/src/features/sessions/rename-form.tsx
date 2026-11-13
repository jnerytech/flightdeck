import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { Field, Form, FormActions } from "@/shared/layout/index.ts";

/** Puts the focus in the open rename form's field, its current name selected. */
export function focusRenameField() {
  const field = document.querySelector<HTMLInputElement>('[data-slot="rename-form"] input');
  field?.focus();
  field?.select();
}

/** Puts the focus back on the actions button of a row (it carries `data-row-actions`). */
export function focusRowActions(claudeSessionId: string | null) {
  document
    .querySelector<HTMLElement>(`[data-row-actions="${CSS.escape(claudeSessionId ?? "")}"]`)
    ?.focus();
}

/**
 * Renames one session of the hub (#2673): a field named after the session with its current name
 * selected, Save and Cancel. Enter saves and Escape cancels. The caller returns the focus to the
 * row's actions button once it closes.
 */
export function RenameForm(
  props: Readonly<{
    title: string;
    onSave(name: string): void;
    onCancel(): void;
  }>,
) {
  const t = useT();
  const [name, setName] = useState(props.title);
  // Focus on opening, current name selected: typing replaces it, an arrow key edits it.
  useEffect(focusRenameField, []);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the form from any of its controls
    <div
      data-slot="rename-form"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onCancel();
      }}
    >
      <Form variant="panel" onSubmit={() => props.onSave(name.trim())}>
        <Field label={t("hub.renameField", { title: props.title })}>
          {(control) => (
            <Input {...control} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <FormActions
          submit={t("hub.saveName")}
          cancel={t("hub.cancelRename")}
          onCancel={props.onCancel}
        />
      </Form>
    </div>
  );
}
