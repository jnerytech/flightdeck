import type { PermissionMode } from "@flightdeck/protocol";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { T } from "../../i18n/index.ts";

/**
 * Under the message box: the model and the permission mode (each a picker when the session lets
 * them change, else plain text) and a spinner while a turn runs.
 */
export function SessionStatusLine(props: {
  t: T;
  model: string | undefined;
  mode: PermissionMode;
  /** The pickers of what the session lets change; the rest shows as text. */
  pickers: { model?: ReactNode; mode?: ReactNode };
  working: boolean;
}) {
  const { t } = props;
  return (
    <fieldset
      data-slot="session-status"
      aria-label={t("session.statusLine")}
      className="session-status"
    >
      {props.pickers.model ?? <span>{props.model ?? t("session.modelDefault")}</span>}
      {props.pickers.mode ?? <span>{t(`modes.${props.mode}.name`)}</span>}
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
