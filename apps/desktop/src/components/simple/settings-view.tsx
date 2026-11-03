import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { FieldRow, NativeSelect } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TContext } from "@/i18n/context";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { LANGS, type Lang, type T } from "../../i18n/index.ts";
import type { ThemeMode } from "../../lib/theme.ts";

export interface SettingsViewProps {
  t: T;
  lang: Lang;
  onLang(lang: Lang): void;
  theme: ThemeMode;
  onTheme(mode: ThemeMode): void;
  /** The folders tasks may use: the host's allowed folders. */
  folders: string[];
  onAddFolder(path: string): Promise<boolean>;
  canPickFolder: boolean;
  onPickFolder(): Promise<string | null>;
  notifications: boolean;
  onNotifications(enabled: boolean): void;
  /** Whether the app offers the way back to the full app (the host is not locked). */
  canSwitch: boolean;
  onShowEverything(): void;
}

const THEMES: readonly ThemeMode[] = ["system", "light", "dark"];

/** The little Settings of simple mode: language, theme, folders, notifications and the switch. */
export function SettingsView(props: SettingsViewProps) {
  const { t } = props;
  const [folder, setFolder] = useState("");
  const [asking, setAsking] = useState(false);

  return (
    <TContext.Provider value={t}>
      <div className="home-simple">
        <h1 className="task-title">{t("simple.settings.title")}</h1>

        <section className="settings-block">
          <h2 className="home-heading">{t("simple.settings.language")}</h2>
          <NativeSelect
            aria-label={t("simple.settings.language")}
            value={props.lang}
            onChange={(e) => props.onLang(e.target.value as Lang)}
          >
            {LANGS.map((lang) => (
              <option key={lang} value={lang}>
                {t(`languages.${lang}`)}
              </option>
            ))}
          </NativeSelect>
        </section>

        <section className="settings-block">
          <h2 className="home-heading">{t("simple.settings.theme")}</h2>
          <NativeSelect
            aria-label={t("simple.settings.theme")}
            value={props.theme}
            onChange={(e) => props.onTheme(e.target.value as ThemeMode)}
          >
            {THEMES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`settings.themes.${mode}`)}
              </option>
            ))}
          </NativeSelect>
        </section>

        <section className="settings-block">
          <h2 className="home-heading">{t("simple.settings.folders")}</h2>
          <p className="question-card-note">{t("simple.settings.foldersHint")}</p>
          {props.folders.length === 0 ? (
            <p className="question-card-note">{t("simple.settings.noFolders")}</p>
          ) : (
            <ul aria-label={t("simple.settings.folders")} className="task-files">
              {props.folders.map((path) => (
                <li key={path} className="task-file">
                  {path}
                </li>
              ))}
            </ul>
          )}
          <FieldRow>
            <Input
              aria-label={t("simple.settings.folderName")}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            />
            {props.canPickFolder && (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  const picked = await props.onPickFolder();
                  if (picked) setFolder(picked);
                }}
              >
                {t("simple.home.chooseFolder")}
              </Button>
            )}
            <ActionButton
              disabled={folder.trim() === ""}
              disabledReason={t("simple.settings.folderNeeded")}
              onClick={async () => {
                if (await props.onAddFolder(folder.trim())) setFolder("");
              }}
            >
              {t("simple.settings.add")}
            </ActionButton>
          </FieldRow>
        </section>

        <section className="settings-block">
          <h2 className="home-heading">{t("simple.settings.notifications")}</h2>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={props.notifications}
              onChange={(e) => props.onNotifications(e.target.checked)}
            />
            {t("simple.settings.notificationsLabel")}
          </label>
        </section>

        {props.canSwitch && (
          <section className="settings-block">
            <h2 className="home-heading">{t("simple.settings.everythingSection")}</h2>
            <p className="question-card-note">{t("simple.settings.everythingHint")}</p>
            <div>
              <Button variant="outline" onClick={() => setAsking(true)}>
                {t("simple.settings.everything")}
              </Button>
            </div>
          </section>
        )}

        {asking && (
          <ConfirmDialog
            message={t("simple.settings.everythingConfirm")}
            confirmLabel={t("simple.settings.everythingYes")}
            onCancel={() => setAsking(false)}
            onConfirm={() => {
              setAsking(false);
              props.onShowEverything();
            }}
          />
        )}
      </div>
    </TContext.Provider>
  );
}
