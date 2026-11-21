/** The `changes` verbs that are high from a shell, with what they are stopped for (#3620). */
export const CHANGES_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [];
