import { runsFlightdeckWords } from "./shell-call.ts";

/**
 * `knowledge set-feed` decides whether every session a project starts is given its document library, text
 * a session then reads as instructions (#3623). The app leaves that to the person, and a switch from a shell
 * is only a typed word, so any line that runs it is high, on or off: a session that can switch the feed can
 * also hide what it was told. `create` writes a new file the project can review, `set-status` moves one status
 * line the hash guards, and the reads grant nothing, so they stay ordinary.
 */
function switchesTheFeed(prog: string, args: string[]): boolean {
  return runsFlightdeckWords(
    prog,
    args,
    ([command, action]) => command === "knowledge" && action === "set-feed",
  );
}

/** The `knowledge` verbs that are high from a shell, with what each is stopped for. */
export const KNOWLEDGE_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: switchesTheFeed,
    reason: () =>
      "switches whether the project's document library is given to every session it starts, a choice the app leaves to the person (flightdeckd knowledge set-feed, on or off)",
  },
];
