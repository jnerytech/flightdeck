import type { EffortLevel } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";

/**
 * The model under the message box, as a chip that opens the Model menu: the models (numbered), a
 * "More models" submenu with the versions, and an Effort submenu when the host can change it.
 */
export function ModelChip(props: {
  t: T;
  /** What the person chose in this view; "" is the default. */
  model: string;
  /** The model the session reports it runs, when known. */
  current: string | undefined;
  /** The effort set from this view; null is the model's default. */
  effort: EffortLevel | null;
  /** The host changes the effort of a live session. */
  effortAvailable: boolean;
  onPickModel(model: string): void;
  onPickEffort(effort: EffortLevel | null): void;
}) {
  return <button type="button">{props.t("session.modelDefault")}</button>;
}
