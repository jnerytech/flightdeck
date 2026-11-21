import { runsCliVerb } from "./shell-call.ts";

/**
 * `file write` replaces a file of a session's, a card's, a terminal's or a project's checkout (#3624). The app
 * has the person open the file and save it; from a shell, `--confirm` and `--hash` are only typed words, so a
 * session could rewrite what another one runs or reads. `list`, `read`, `search`, `dirs` and `files` only read,
 * so they stay ordinary.
 */
const writesAFile = (prog: string, args: string[]) => runsCliVerb(prog, args, "file", ["write"]);

/** The `file` verbs that are high from a shell, with what they are stopped for. */
export const FILE_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: writesAFile,
    reason: () =>
      "replaces a file of a session's, a card's, a terminal's or a project's checkout, without the person opening it in the app and saving it; a typed --confirm or --hash is not the person (flightdeckd file write)",
  },
];
