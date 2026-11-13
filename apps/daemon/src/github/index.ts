/**
 * The github domain's public entry (#1612): the one place `gh` is run from for a PR. Another domain
 * imports from here, never a file inside.
 */
export { GithubCli } from "./adapters/gh-pr.ts";
