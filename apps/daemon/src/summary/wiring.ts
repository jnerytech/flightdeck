import type { DomainModule } from "../server/index.ts";
import { SummaryService, type SummaryServiceOptions } from "./service.ts";

/** The summary of a session, served to the app: built from its transcript and its usage. */
export function createSummary(options: SummaryServiceOptions) {
  const module: DomainModule<"summary"> = { server: { summary: new SummaryService(options) } };
  return { modules: [module] as const };
}
