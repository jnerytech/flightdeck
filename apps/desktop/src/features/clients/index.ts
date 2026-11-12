/**
 * Which client the person works for, public entry in the app (#1589, #1596): the selection of the
 * work screens and the client of each project. Another domain imports from here, never a file inside.
 */

export { costByClient, loadCostsSummary, mergeSummaries } from "./client-costs.ts";
export { knownProjects } from "./client-rules-model.ts";
export {
  ALL_CLIENTS,
  type ClientScope,
  loadSelection,
  selectedClient,
  sessionProjectKeys,
  tagsFirst,
} from "./client-scope.ts";
export {
  effectiveRules,
  generatedScopeRules,
  groupSecrets,
  isGeneratedRule,
  SCOPE_RULE_PREFIX,
  scopingClient,
  stripGenerated,
} from "./client-vault.ts";
export { type Client, type ClientColor, Clients, UNASSIGNED } from "./clients.ts";
export { ClientScopeSlice } from "./scope-store.ts";
export { wireClientScope } from "./wire.ts";
