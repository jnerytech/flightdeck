/**
 * The pr domain's public entry (#1612): what every PR host has in common. The port (`PrProvider`
 * and the shapes it answers with), the CLI runner that starts `gh` and `az` from the current PATH,
 * the safe text of their arguments and the reading of what they answer. A host's own adapter (the
 * GitHub one, the Azure DevOps one) builds on this; another domain imports from here.
 */
export { CliProvider, cli, cliOk } from "./cli.ts";
export { BUILD_LOG_BYTES, summarize, tail, urlName } from "./host-output.ts";
export {
  type CommandRunner,
  type CreatePr,
  type PrCheck,
  type PrComment,
  type PrHealth,
  type PrProvider,
  type PrStatus,
  prMessage,
} from "./port.ts";
export { azureDetails, githubDetails } from "./pr-details.ts";
