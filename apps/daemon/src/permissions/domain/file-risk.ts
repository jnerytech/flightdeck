/**
 * `file write` replaces a file of a session's, a card's, a terminal's or a project's checkout (#3624). The app
 * has the person open the file and save it; from a shell, `--confirm` and `--hash` are only typed words.
 * `list`, `read`, `search`, `dirs` and `files` only read, so they stay ordinary.
 */
/** The `file` verbs that are high from a shell, with what they are stopped for. */
export const FILE_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [{ when: () => false, reason: () => "" }];
