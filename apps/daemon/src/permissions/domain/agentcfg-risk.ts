import { runsCliVerb } from "./shell-call.ts";

/**
 * `agentcfg write` replaces a project's CLAUDE.md, an agent or a skill: text every later session of the
 * project reads as its own instructions (#3617). The app has the person read the file and save it; from a
 * shell, `--confirm` and `--expected-hash` are only typed words, so a session could plant instructions for
 * the next one. `list` and `read` only read, so they stay ordinary.
 */
const writesAgentConfig = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "agentcfg", ["write"]);

/** The `agentcfg` verbs that are high from a shell, each with what it is stopped for. */
export const AGENTCFG_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: writesAgentConfig,
    reason: () =>
      "writes a CLAUDE.md, an agent or a skill, which every later session of the project reads as its own instructions, without the person reading it in the app; a typed --confirm or --expected-hash is not the person (flightdeckd agentcfg write)",
  },
];
