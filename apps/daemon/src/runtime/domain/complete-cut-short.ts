import { FlightdeckError, type UsageTokens } from "../../kernel/index.ts";

/** Issue #1439: a one-shot call cut short (turns or budget), with what it used, so the cost counts. */
export class CompleteCutShort extends FlightdeckError {
  constructor(
    subtype: string,
    readonly tokens: UsageTokens,
  ) {
    super("invalid_state", `cut short: ${subtype}`, "assistant_truncated");
  }
}
