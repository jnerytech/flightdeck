import { type ReactNode, useId, useSyncExternalStore } from "react";
import type { CacheTtl } from "@/features/sessions/index.ts";
import type { Density, ThemeMode } from "@/features/shell/index.ts";
import { NativeSelect, Panel } from "@/shared/layout/index.ts";
import { LANGS, type Lang, type T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import type { TabOrder } from "../tabs/index.ts";
import { TERMINAL_FONT_MAX, TERMINAL_FONT_MIN } from "../terminal/index.ts";
import { TerminalFontInput } from "./terminal-font-input.tsx";

/** A setting: its label on the left and its control on the right; the label focuses the control. */
function SettingRow(props: Readonly<{ label: string; children: (id: string) => ReactNode }>) {
  const id = useId();
  return (
    // One label column for every row, so the controls start on one line whatever the label (#588).
    <div className="setting-row">
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
    </div>
  );
}

/** A checkbox with its sentence on its right. */
export const check = "flex items-center gap-2 text-sm";

/** The Appearance block: theme, density, language, the cache timer, tab order and the terminal. */
export function AppearanceSection(
  props: Readonly<{
    store: AppStore;
    t: T;
    /** Light, dark or the system's (phase 10). */
    theme: ThemeMode;
    onTheme(mode: ThemeMode): void;
    /** The list rows' height (phase 10). */
    density: Density;
    onDensity(density: Density): void;
    /** pt-BR or English (phase 10). */
    lang: Lang;
    onLang(lang: Lang): void;
  }>,
) {
  const { store, t } = props;
  const terminalFont = useSyncExternalStore(
    store.terminalFont.subscribe,
    () => store.terminalFont.value,
  );
  const terminalReader = useSyncExternalStore(
    store.terminalReader.subscribe,
    () => store.terminalReader.value,
  );
  const readerHint = useId();
  const fontHint = useId();
  const cacheOn = useSyncExternalStore(store.cacheTimer.subscribe, () => store.cacheTimer.enabled);
  const cacheTtl = useSyncExternalStore(store.cacheTimer.subscribe, () => store.cacheTimer.ttl);
  const tabOrder = useSyncExternalStore(store.tabOrder.subscribe, () => store.tabOrder.value);
  return (
    <Panel title={t("prefs.appearance")}>
      <SettingRow label={t("settings.theme")}>
        {(id) => (
          <NativeSelect
            id={id}
            className="setting-select"
            value={props.theme}
            onChange={(e) => props.onTheme(e.target.value as ThemeMode)}
          >
            <option value="system">{t("settings.themes.system")}</option>
            <option value="light">{t("settings.themes.light")}</option>
            <option value="dark">{t("settings.themes.dark")}</option>
          </NativeSelect>
        )}
      </SettingRow>
      <SettingRow label={t("settings.density")}>
        {(id) => (
          <NativeSelect
            id={id}
            className="setting-select"
            value={props.density}
            onChange={(e) => props.onDensity(e.target.value as Density)}
          >
            <option value="compact">{t("settings.densities.compact")}</option>
            <option value="comfortable">{t("settings.densities.comfortable")}</option>
          </NativeSelect>
        )}
      </SettingRow>
      <label className={check}>
        <input
          type="checkbox"
          checked={cacheOn}
          onChange={(e) => store.cacheTimer.setEnabled(e.target.checked)}
        />
        {t("settings.cacheTimer")}
      </label>
      <SettingRow label={t("settings.cacheTtl")}>
        {(id) => (
          <NativeSelect
            id={id}
            className="setting-select"
            value={String(cacheTtl)}
            onChange={(e) => store.cacheTimer.setTtl(Number(e.target.value) as CacheTtl)}
          >
            <option value="300000">{t("settings.cacheTtls.fiveMinutes")}</option>
            <option value="3600000">{t("settings.cacheTtls.oneHour")}</option>
          </NativeSelect>
        )}
      </SettingRow>
      <SettingRow label={t("settings.tabOrder")}>
        {(id) => (
          <NativeSelect
            id={id}
            className="setting-select"
            value={tabOrder}
            onChange={(e) => store.tabOrder.set(e.target.value as TabOrder)}
          >
            <option value="mru">{t("settings.tabOrders.mru")}</option>
            <option value="sequential">{t("settings.tabOrders.sequential")}</option>
          </NativeSelect>
        )}
      </SettingRow>
      <SettingRow label={t("settings.terminalFont")}>
        {(id) => (
          <TerminalFontInput
            id={id}
            describedBy={fontHint}
            size={terminalFont}
            onCommit={(size) => store.terminalFont.set(size)}
          />
        )}
      </SettingRow>
      <small id={fontHint} className="setting-hint">
        {t("settings.terminalFontRange", { min: TERMINAL_FONT_MIN, max: TERMINAL_FONT_MAX })}
      </small>
      <label className={check}>
        <input
          type="checkbox"
          checked={terminalReader}
          aria-describedby={readerHint}
          onChange={(e) => store.terminalReader.set(e.target.checked)}
        />
        {t("settings.terminalReader")}
      </label>
      <small id={readerHint} className="setting-hint">
        {t("settings.terminalReaderHint")}
      </small>
      <SettingRow label={t("settings.language")}>
        {(id) => (
          <NativeSelect
            id={id}
            className="setting-select"
            value={props.lang}
            onChange={(e) => props.onLang(e.target.value as Lang)}
          >
            {LANGS.map((lang) => (
              <option key={lang} value={lang}>
                {t(`languages.${lang}`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </SettingRow>
    </Panel>
  );
}
