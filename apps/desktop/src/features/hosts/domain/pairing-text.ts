import type { T } from "../../../i18n/index.ts";
import type { LinkProblem } from "./pairing-mask.ts";

/** The words for a refused pairing link, in the app's language. */
export function pairingErrorText(t: T, error: LinkProblem): string {
  switch (error) {
    case "scheme":
      return t("hostForm.pairScheme");
    case "address":
      return t("hostForm.pairAddress");
    case "port":
      return t("hostForm.pairPort");
    case "token":
      return t("hostForm.pairToken");
    case "elsewhere":
      return t("hostForm.pairElsewhere");
  }
}
