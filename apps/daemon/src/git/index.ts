/**
 * The git domain's public entry (#1612): the one place `git` is run from. The runners keep the
 * calls of the other domains short (an explicit working directory, the PATH of the moment, an
 * optional byte and time limit); another domain imports from here.
 */

export { git, gitBytes, gitLimited, gitLimitedFor, gitWith } from "./adapters/git.ts";
