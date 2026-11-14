/**
 * Issue #1288: the assistant domain: the wand's provider runs a request and can be cancelled,
 * reads the context a request needs, and records what the person kept.
 */
import type { AssistantService } from "../../assistant/index.ts";
import { featureOff } from "../../kernel/index.ts";
import type { ServerContext } from "../context.ts";
import type { Handlers } from "../dispatch.ts";

/** The assistant, or the `feature_off` refusal when this host has none. */
function assistant(server: ServerContext): AssistantService {
  if (!server.opts.assistant) throw featureOff("assistant");
  return server.opts.assistant;
}

export const assistantHandlers = {
  "assistant.run": async (payload, { server }) => {
    return await assistant(server).run(payload);
  },
  "assistant.cancel": (payload, { server }) => {
    assistant(server).cancel(payload.requestId);
    return undefined;
  },
  "assistant.context": async (payload, { server }) => {
    return await assistant(server).context(payload);
  },
  "assistant.record": (payload, { server }) => {
    assistant(server).record(payload);
    return undefined;
  },
} satisfies Partial<Handlers>;
