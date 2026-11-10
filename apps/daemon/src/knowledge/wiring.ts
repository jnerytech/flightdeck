import { resolve } from "node:path";
import { type Config, expandHome, updateConfigFile } from "../config.ts";
import { createKnowledgeDoc } from "./create.ts";
import { listKnowledge } from "./list.ts";
import { knowledgeFeedFor } from "./serve.ts";
import { setKnowledgeStatus } from "./status.ts";
import { type KnowledgeSwitchDeps, knowledgeSwitchFor } from "./switch.ts";

/** What the host's knowledge library is served from. */
export interface KnowledgeDeps {
  config: Pick<Config, "knowledge">;
  configFile: string;
  /** Looks at the folder's git boundary, then says whether its own files may load and from where. */
  trust: KnowledgeSwitchDeps["trust"];
}

/**
 * The knowledge library the server offers (#76, issue #1593): its list, status and new documents,
 * the index fed to a session in a trusted folder, and the switch that turns that feed off per
 * folder, kept in the config.
 */
export function createKnowledge({ config, configFile, trust }: KnowledgeDeps) {
  return {
    knowledge: listKnowledge,
    knowledgeStatus: setKnowledgeStatus,
    knowledgeCreate: createKnowledgeDoc,
    knowledgeFeed: knowledgeFeedFor({
      off: () => config.knowledge.feedOff,
      trust,
    }),
    knowledgeFeedSwitch: knowledgeSwitchFor({
      off: () => config.knowledge.feedOff,
      trust,
      change: async (update) => {
        let next: string[] = [];
        await updateConfigFile(configFile, (raw) => {
          const section = (typeof raw.knowledge === "object" ? raw.knowledge : null) ?? {};
          const listed = (section as { feedOff?: unknown }).feedOff;
          const entries = Array.isArray(listed) ? listed.filter((e) => typeof e === "string") : [];
          next = update(entries);
          return { ...raw, knowledge: { ...section, feedOff: next } };
        });
        config.knowledge.feedOff = next.map((entry) => resolve(expandHome(entry)));
      },
    }),
  };
}
