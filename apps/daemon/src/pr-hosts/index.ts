/**
 * The PR hosts' public entry (#1589): the provider a project's PR host setting names (GitHub through
 * `gh`, Azure DevOps through `az`), the detection of that host from the project's `origin` remote,
 * and the reading of an Azure DevOps remote that the issues share. What every host has in common
 * (the `PrProvider` port) lives in `pr/`.
 */

export { azureCoords } from "./domain/azure-remote.ts";
export { prProvider } from "./pr.ts";
export { detectProvider } from "./pr-provider.ts";
