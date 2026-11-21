import { runsCliVerb } from "./shell-call.ts";

/**
 * `memory write` and `memory delete` change a note in a project's auto memory: text every later session of the
 * project loads at its start as its own memory (#3618). The app has the person open the note and save it; from a
 * shell, `--confirm` and `--expected-hash` are only typed words, so a session could plant or erase notes for the
 * next one. `list`, `read`, `budget` and `suggest` only read, so they stay ordinary.
 */
const changesMemory = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "memory", ["write", "delete"]);

/** The `memory` verbs that are high from a shell, each with what it is stopped for. */
export const MEMORY_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: changesMemory,
    reason: () =>
      "writes or deletes a note in a project's auto memory, which every later session of the project loads at its start as its own memory, without the person reading it in the app; a typed --confirm or --expected-hash is not the person (flightdeckd memory write, memory delete)",
  },
];
