import type { HostInfoResult } from "@flightdeck/protocol";
import type { AppKernel, HostCommandType } from "../../lib/kernel.ts";
import { hasFeature } from "../../lib/version.ts";
import { AssistantController, type AssistantControllerDeps, type HostAnswer } from "./assistant.ts";

/** The part of the app state the assistant reads: the hosts it may ask, the vault's names. */
interface AssistantState {
  hosts: Array<{ id: string; name: string; status: string; hostInfo: HostInfoResult | null }>;
  secrets: Array<{ id: string; name: string }>;
}

/**
 * Builds the assistant from the store's kernel (#1596): the hosts that offer it and the vault's
 * entries come from the state, a host's answer through `hostRequest`. The storage, the shell's
 * API and the language stay the store's, as deps.
 */
export function wireAssistant(
  kernel: AppKernel<AssistantState>,
  deps: Pick<AssistantControllerDeps, "storage" | "api" | "language">,
): AssistantController {
  return new AssistantController({
    storage: deps.storage,
    api: deps.api,
    hosts: () =>
      kernel.state().hosts.map((host) => ({
        id: host.id,
        name: host.name,
        online: host.status === "online",
        assistant: hasFeature(host.hostInfo?.features, "assistant", false),
      })),
    secrets: () => kernel.state().secrets.map((secret) => ({ id: secret.id, name: secret.name })),
    language: deps.language,
    request: (hostId, type, payload) =>
      kernel.hostRequest(hostId, type as HostCommandType, payload as never) as Promise<HostAnswer>,
  });
}
