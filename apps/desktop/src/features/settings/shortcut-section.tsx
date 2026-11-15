import { useState } from "react";
import { Input } from "@/components/ui/input";
import type { T } from "@/i18n/index.ts";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { Field, Form, FormActions, Panel } from "@/shared/layout/index.ts";
import type { Settings as SettingsState } from "./index.ts";

/** The Shortcut block: the global key that opens the search, with its problem, its error and Save. */
export function ShortcutSection(
  props: Readonly<{ settings: SettingsState; t: T; onGlobalShortcut(text: string): void }>,
) {
  const { settings, t } = props;
  const [shortcut, setShortcut] = useState(settings.globalShortcut);
  const shortcutOff = !settings.globalShortcutSupported;
  return (
    <Panel title={t("prefs.shortcut")}>
      {settings.shortcutProblem && <InlineNotice>{settings.shortcutProblem}</InlineNotice>}
      <Form variant="inline" onSubmit={() => props.onGlobalShortcut(shortcut)}>
        <Field
          label={t("prefs.shortcut")}
          help={t("prefs.shortcutNote")}
          error={settings.shortcutError}
        >
          {(control) => (
            <Input
              {...control}
              className="w-56"
              value={shortcut}
              disabled={shortcutOff}
              onChange={(e) => setShortcut(e.target.value)}
            />
          )}
        </Field>
        <FormActions
          submit={t("prefs.saveShortcut")}
          disabled={shortcutOff || shortcut === settings.globalShortcut}
          disabledReason={
            shortcutOff ? t("prefs.shortcutUnavailable") : t("prefs.shortcutUnchanged")
          }
        />
      </Form>
    </Panel>
  );
}
