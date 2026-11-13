import { AutomationAction, AutomationTrigger } from "@flightdeck/protocol";
import { parseJsonWith } from "../kernel/index.ts";

/** The JSON columns of an automation row, read through the protocol's schemas (#1609). */

/** What fires the automation. Throws when the column does not fit: nothing fires from a guess. */
export const triggerOf = (text: string): AutomationTrigger =>
  parseJsonWith(AutomationTrigger, text);

/** What the automation does. Throws when the column does not fit: nothing runs from a guess. */
export const actionOf = (text: string): AutomationAction => parseJsonWith(AutomationAction, text);
