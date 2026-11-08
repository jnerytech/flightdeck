import type { PermissionMode } from "@flightdeck/protocol";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { T } from "../../i18n/index.ts";

/**
 * Under the message box: the model and the permission mode (each a picker when the session lets
 * them change, else plain text) and a spinner while a turn runs.
 */
export function SessionStatusLine(
  props: Readonly<{
    t: T;
    model: string | undefined;
    /** Null while the session has not said its mode. */
    mode: PermissionMode | null;
    /** The pickers of what the session lets change; the rest shows as text. */
    pickers: { model?: ReactNode; mode?: ReactNode };
    working: boolean;
    /** The prompt cache countdown of an idle session, next to the model. */
    cache?: ReactNode;
  }>,
) {
  const { t } = props;
  return (
    <fieldset
      data-slot="session-status"
      aria-label={t("session.statusLine")}
      className="session-status"
    >
      {props.pickers.model ?? <span>{props.model ?? t("session.modelDefault")}</span>}
      {props.pickers.mode ?? (
        <span>{props.mode ? t(`modes.${props.mode}.name`) : t("session.modeUnknown")}</span>
      )}
      {props.cache}
      {props.working && (
        <Loader2
          data-slot="session-spinner"
          aria-hidden="true"
          className="size-3.5 motion-safe:animate-spin"
        />
      )}
    </fieldset>
  );
}
