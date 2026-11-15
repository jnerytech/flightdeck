import type { Template } from "@flightdeck/protocol";
import type { T } from "../../../i18n/index.ts";
import type { ConnectionStatus } from "../../hosts/index.ts";

/** The required fields' names, so a card says what it will ask before it is opened. */
export function askedFor(template: Template, lang: T["lang"]): string {
  return template.fields
    .filter((field) => !field.optional)
    .map((field) => field.label[lang])
    .join(", ");
}

/** What the connection is called on Home. */
export function stateLabel(status: ConnectionStatus, t: T): string {
  switch (status) {
    case "online":
      return t("simple.home.connected");
    case "connecting":
      return t("simple.home.connecting");
    case "unauthorized":
      return t("simple.home.notAccepted");
    case "incompatible":
      return t("simple.home.needsUpdate");
    default:
      return t("simple.home.notConnected");
  }
}

/** Why tasks cannot start and what to do, or null while the host is online or connecting. */
export function stateNotice(status: ConnectionStatus, t: T, host: string): string | null {
  switch (status) {
    case "offline":
      return t("simple.home.offline", { host });
    case "unauthorized":
      return t("simple.home.unauthorized", { host });
    case "incompatible":
      return t("simple.home.incompatible", { host });
    default:
      return null;
  }
}
