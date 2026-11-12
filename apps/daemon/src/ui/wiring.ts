import { type Config, updateConfigFile } from "../config.ts";
import type { DomainModule } from "../server/index.ts";

/** What the host's presentation is built from. */
export interface UiDeps {
  config: Pick<Config, "ui">;
  configFile: string;
}

/**
 * How this host presents itself (phase 33): the default mode and the lock the app reads, which
 * `ui.set` changes and the config file keeps like the other host settings.
 */
export function createUi({ config, configFile }: UiDeps) {
  const module: DomainModule<"ui" | "onUiSettings"> = {
    server: {
      // The handler changes this object once the file is written.
      ui: { ...config.ui },
      onUiSettings: (ui) => updateConfigFile(configFile, (raw) => ({ ...raw, ui })),
    },
  };
  return { modules: [module] as const };
}
