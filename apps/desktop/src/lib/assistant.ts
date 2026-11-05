import type { AssistantKind, AssistantResult } from "@flightdeck/protocol";
import type { AssistantPlatform } from "@/platform/types";
import { RunGate } from "../components/assistant/wand-state.ts";
import {
  type AssistantPrefs,
  defaultPrefs,
  type HostChoice,
  type ResolvedProvider,
} from "./assistant-prefs.ts";

/** What a failed call carries to the screen: a reason it translates, and the values the text fills in. */
export interface AssistantFailure {
  reason: string;
  params?: Record<string, string | number>;
}

export type HostAnswer =
  | { ok: true; data: unknown }
  | {
      ok: false;
      code: string;
      message: string;
      reason?: string;
      params?: Record<string, string | number>;
    };

export interface AssistantControllerDeps {
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  api: AssistantPlatform;
  hosts: () => HostChoice[];
  secrets: () => Array<{ id: string; name: string }>;
  language: () => string;
  request: (hostId: string, type: string, payload: unknown) => Promise<HostAnswer>;
}

export interface AssistantRunInput {
  requestId: string;
  kind: AssistantKind;
  text: string;
  context?: Record<string, string>;
  fieldHostId?: string;
  cwd?: string;
}

export class AssistantController {
  readonly gate = new RunGate();
  constructor(private readonly deps: AssistantControllerDeps) {}
  prefs(): AssistantPrefs {
    return defaultPrefs();
  }
  setPrefs(_patch: Partial<AssistantPrefs>): void {}
  subscribe(_listener: () => void): () => void {
    return () => {};
  }
  keys(): { anthropic: boolean; openrouter: boolean } {
    return { anthropic: true, openrouter: true };
  }
  async refreshKeys(): Promise<void> {}
  resolve(_fieldHostId?: string): ResolvedProvider | null {
    return null;
  }
  async run(_input: AssistantRunInput): Promise<AssistantResult> {
    return this.deps ? ({} as AssistantResult) : ({} as AssistantResult);
  }
  async cancel(_requestId: string, _on: ResolvedProvider): Promise<void> {}
}
