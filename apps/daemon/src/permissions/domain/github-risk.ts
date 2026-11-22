import { runsCliVerb } from "./shell-call.ts";

/**
 * `github login`, `logout` and `start` (#3703). The sign-in prints a one-time code that a person types on github.com; a
 * logout ends every feature that reads the host's repositories and issues; a start clones a repository and opens a card or
 * a Claude session whose prompt is an issue's text, which anyone can write. The app has the person start or confirm each
 * one; from a shell, a typed `--confirm` is not the person. `status`, `repos` and `issues` only read, so they stay ordinary.
 */
const runs = (verb: string) => (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "github", [verb]);

/** The `github` verbs that are high from a shell, with what they are stopped for. */
export const GITHUB_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: runs("login"),
    reason: () =>
      "starts the GitHub device sign-in of this host, whose one-time code a person types on github.com, which the app asks the person to start (flightdeckd github login)",
  },
  {
    when: runs("logout"),
    reason: () =>
      "signs this host out of GitHub, which ends every feature that reads its repositories and issues and which the app asks the person to confirm (flightdeckd github logout)",
  },
  {
    when: runs("start"),
    reason: () =>
      "clones a repository into a folder of this host and opens a card or a Claude session on it, with an issue's text as the prompt, which the app asks the person to confirm (flightdeckd github start)",
  },
];
