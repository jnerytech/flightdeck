import { FlightdeckError } from "../../kernel/index.ts";

/** `owner/name`: letters, digits, dots, underscores and dashes. */
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;

/** A repo is `owner/name`, checked before it reaches gh as an argument. */
export function checkRepo(repo: string): void {
  if (!REPO.test(repo) || /\/\.+$/.test(repo)) {
    throw new FlightdeckError(
      "invalid_state",
      `${repo} is not an owner/name repository`,
      "repo_invalid",
      { repo },
    );
  }
}
