import { Input } from "@/components/ui/input";
import type { T } from "@/i18n/index.ts";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { Field, Form, FormActions, Panel } from "@/shared/layout/index.ts";
import type { Settings as SettingsState } from "./index.ts";

/**
 * The Shortcut block: the global key that opens the search, with its problem, its error and Save.
 * The page holds the draft, so a search that hides the block does not lose an unsaved edit.
 */
export function ShortcutSection(
  props: Readonly<{
    settings: SettingsState;
    t: T;
    draft: string;
    onDraft(text: string): void;
    onGlobalShortcut(text: string): void;
  }>,
) {
  const { settings, t, draft: shortcut } = props;
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
              onChange={(e) => props.onDraft(e.target.value)}
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
