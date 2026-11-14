/**
 * The vault's public entry (#1589): the secrets the app hands over for one use, the rules of who
 * may use which, the decisions and requests a person answers, and their CSV report. Another domain
 * imports from here, never a file inside.
 */
export { Decisions } from "./decisions.ts";
export { toCsv } from "./domain/report.ts";
export {
  evaluate,
  localTime,
  type Purpose,
  type Risk,
  type RulesEnv,
  type UseContext,
} from "./domain/rules.ts";
export { decideRequest, type RequestDecision, requesterOf } from "./requests.ts";
export { VaultRules } from "./rules-store.ts";
export { isVaultTransport, requireVaultTransport, Vault, vaultActions } from "./vault.ts";
