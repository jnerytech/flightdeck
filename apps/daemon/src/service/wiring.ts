import { present } from "../kernel/index.ts";
import type { DomainModule } from "../server/index.ts";
import { appServiceInstall } from "./from-app.ts";
import type { ServiceContext } from "./install.ts";

/** What the app's "install as a service" action is built from. */
export interface ServiceInstallDeps {
  /** The `--config` this daemon was started with, if any. */
  config: string | null;
  configFile: string;
  ctxOf(dryRun: boolean): ServiceContext;
  /** This daemon's own command line. */
  self: string[];
}

/**
 * The app's "install as a service" action, as the module the server takes `serviceInstall` from.
 * A daemon that is not the app's own binary has none, so the key is absent and the app never offers it.
 */
export function createServiceInstall({ config, configFile, ctxOf, self }: ServiceInstallDeps) {
  const module: DomainModule<"serviceInstall"> = {
    server: present({ serviceInstall: appServiceInstall(config, configFile, ctxOf, self) }),
  };
  return { modules: [module] as const };
}
