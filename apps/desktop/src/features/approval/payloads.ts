import type { ApprovalProof, HARNESS_PREVIEW_PARTS } from "@flightdeck/protocol";
// The payloads the app signs for the commands that move code or trust, and the person's no for each.

/** The payload of a guarded merge, or the person's no (#3453). */
export type MergePayload = { kind: "payload"; payload: MergeBody } | { kind: "declined" };

/** The payload of `roots.add`, or the person's no (#3507). */
export type RootsPayload =
  | { kind: "payload"; payload: { path: string; confirm: true; proof?: ApprovalProof } }
  | { kind: "declined" };

/** The payload of `project.harness.apply`, or the person's no (#3507). */
export type HarnessPayload =
  | { kind: "payload"; payload: HarnessBody & { proof?: ApprovalProof } }
  | { kind: "declined" };

/** What `project.harness.apply` asks for: the folder, the parts, the preview's digests and the options. */
export interface HarnessBody {
  path: string;
  parts: Array<(typeof HARNESS_PREVIEW_PARTS)[number]>;
  digests: Record<string, string>;
  confirm: true;
  reformat?: true;
  template?: string;
}

/** The payload of `host.bypass` that turns bypass on, or the person's no (#3507). */
export type BypassPayload = { kind: "payload"; payload: BypassBody } | { kind: "declined" };

/** `host.bypass` turning bypass on: the proof is there only for a host that checks it and has a device enrolled. */
export interface BypassBody {
  allow: true;
  confirm: true;
  proof?: ApprovalProof;
}

/** `card.pr.merge`'s payload: the head binding and the proof are there only for a host that checks them. */
export interface MergeBody {
  cardId: string;
  method: "merge" | "squash";
  confirm: boolean;
  prUrl?: string;
  headSha?: string;
  proof?: { keyId: string; nonce: string; signature: string };
}

/** The payload of `project.trust.set`, or the person's no (#3453). */
export type TrustPayload =
  | {
      kind: "payload";
      payload: {
        path: string;
        trusted: boolean;
        proof?: { keyId: string; nonce: string; signature: string };
      };
    }
  | { kind: "declined" };

/** The payload of `snippets.trust`, or the person's no (#3647). */
export type SnippetTrustPayload =
  | {
      kind: "payload";
      payload: {
        projectPath: string;
        hash: string;
        proof?: { keyId: string; nonce: string; signature: string };
      };
    }
  | { kind: "declined" };

/** The payload of `autoapprove.resume`, or the person's no (#3453). */
export type ResumePayload =
  | {
      kind: "payload";
      payload: {
        sessionKey: string;
        confirm: boolean;
        proof?: { keyId: string; nonce: string; signature: string };
      };
    }
  | { kind: "declined" };

/** What `plugins.install` and `plugins.update` send: the plugin or folder, the hashes and the scope (#3516). */
export interface PluginBody {
  plugin?: string;
  dir?: string;
  scope?: "user" | "project" | "local";
  confirmHash: string;
  acceptCommand?: string;
}

/** The payload of `plugins.marketplaceAdd`, or the person's no (#3516). */
export type MarketplacePayload =
  | {
      kind: "payload";
      payload: {
        source: string;
        scope?: "user" | "project" | "local";
        confirm: true;
        proof?: ApprovalProof;
      };
    }
  | { kind: "declined" };

/** The payload of `plugins.install` or `plugins.update`, or the person's no (#3516). */
export type PluginPayload<B extends PluginBody = PluginBody> =
  | { kind: "payload"; payload: B & { proof?: ApprovalProof } }
  | { kind: "declined" };
