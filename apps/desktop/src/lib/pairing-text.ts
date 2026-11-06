import type { PairingError } from "@flightdeck/protocol";
import type { T } from "../i18n/index.ts";

/** The words for a refused pairing link, in the app's language. */
export function pairingErrorText(t: T, error: PairingError): string {
  switch (error) {
    case "scheme":
      return t("hostForm.pairScheme");
    case "address":
      return t("hostForm.pairAddress");
    case "port":
      return t("hostForm.pairPort");
    case "token":
      return t("hostForm.pairToken");
  }
}
