import type { HarnessPreview, ProjectLoad } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, settleMaybe } from "../wait.ts";

registerDom();
export const { act, cleanup, fireEvent, render, screen, within } = await import(
  "@testing-library/react"
);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { ProjectPage } = await import("../../src/features/projects/project.tsx");

/**
 * Issue #75, slice S4b: the project page sets up what the preview proposes, after the person read
 * it. The app sends back the digests of the preview it showed, never content.
 */
const LOAD: ProjectLoad = {
  path: "/work/api",
  hooks: [],
  mcpServers: [],
  envKeys: [],
  allowRules: [],
  defaultMode: null,
  agents: [],
  skills: [],
  commands: [],
  claudeMd: false,
  executables: [],
  redirects: [],
  plugins: [],
  otherKeys: [],
  extras: [],
  unreadable: [],
  omitted: { hooks: 0, mcpServers: 0, allowRules: 0, envKeys: 0 },
};
export const ALL = ["claudeMd", "hooks", "skills", "agents", "permissions"];
export const SETTINGS = ".claude/settings.json";
export const PROPOSAL: NonNullable<HarnessPreview["settings"]> = {
  path: SETTINGS,
  hash: null,
  hooks: [{ event: "PostToolUse", matcher: "Edit|MultiEdit|Write", command: "bun run format" }],
  denyRules: ["Read(./.env)", "Bash(git add -A:*)"],
  conflicts: ["hooks.PreToolUse"],
  reformats: false,
  digest: "d-settings",
};
export const PREVIEW: HarnessPreview = {
  settings: PROPOSAL,
  files: [{ path: "CLAUDE.md", content: "# Project notes\n", digest: "d-claude" }],
  unreadable: [".claude/skills/tdd/SKILL.md"],
};
export const FEATURES = ["projectTrust", "harnessPreview", "harnessApply"];
export type Answer =
  | { ok: true; data: unknown }
  | {
      ok: false;
      code: string;
      message: string;
      reason?: string;
      params?: Record<string, string>;
    };

export function setup(
  options: {
    language?: "en" | "pt-BR";
    features?: string[];
    trusted?: boolean;
    preview?: HarnessPreview;
    answers?: Array<Answer | Promise<Answer>>;
    /** The host's setup templates (`harness.templates.list`). */
    templates?: Array<{ id: string; title: string; files: string[]; bytes: number }>;
    /** What each later listing says (the last one repeats): a template deleted meanwhile. */
    laterTemplates?: Array<Array<{ id: string; title: string; files: string[]; bytes: number }>>;
    /** A preview that names a template is refused (it is gone): the banner, and no preview. */
    previewRefusesTemplate?: boolean;
    /** The first preview is refused (a path the host will not read); the next one answers. */
    previewRefusedOnce?: { code: string; message: string };
    /** Every preview waits until `releasePreview()` is called. */
    previewHeld?: boolean;
    /** The host asks a device to sign the apply (#3507): the person signs, says no, or the signing fails. */
    proof?: "signed" | "declined" | "fails";
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.projectList.load = (async () => []) as never;
  store.sessionLists.refresh = (async () => {}) as never;
  const sent: Array<[string, unknown]> = [];
  const signed: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  if (options.proof) {
    store.approval.harnessPayload = (async (_host: string, body: Record<string, unknown>) => {
      signed.push(body);
      if (options.proof === "fails") throw new Error("no key on this device");
      return options.proof === "declined"
        ? { kind: "declined" }
        : {
            kind: "payload",
            payload: { ...body, proof: { keyId: "k", nonce: "n", signature: "s" } },
          };
    }) as never;
    store.reportError = ((message: string) => {
      errors.push(message);
    }) as never;
  }
  const answers = [
    ...(options.answers ?? [{ ok: true, data: { written: [SETTINGS, "CLAUDE.md"] } }]),
  ];
  let refusedOnce = options.previewRefusedOnce;
  let releasePreview = () => {};
  const previewGate = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    if (type === "project.trust.state") {
      return { items: [{ path: "/work/api", trusted: options.trusted ?? false, via: null }] };
    }
    if (type === "project.trust.inspect") return LOAD;
    if (type === "harness.templates.list") {
      const asked = sent.filter(([sentType]) => sentType === "harness.templates.list").length;
      const later = options.laterTemplates;
      const now = asked > 1 && later ? (later[Math.min(asked - 2, later.length - 1)] ?? []) : null;
      return { templates: now ?? options.templates ?? [] };
    }
    return null;
  }) as never;
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    if (type === "project.harness.preview") {
      if (options.previewHeld) await previewGate;
      const named = (payload as { template?: string }).template !== undefined;
      const refusal = refusedOnce;
      refusedOnce = undefined;
      if (refusal) return { ok: false, ...refusal };
      return options.previewRefusesTemplate && named
        ? { ok: false, code: "invalid_state", message: "there is no such template" }
        : { ok: true, data: options.preview ?? PREVIEW };
    }
    return answers.shift() ?? { ok: false, code: "invalid_state", message: "no answer" };
  }) as never;
  const appState = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: { daemonVersion: "x", features: options.features ?? FEATURES },
        sessions: [],
      },
    ],
    projects: { h1: [{ id: "p1", name: "api", path: "/work/api", baseBranch: "main" }] },
  } as never as ReturnType<typeof store.getState>;
  const view = (
    <ProjectPage store={store} state={appState} hostId="h1" projectId="p1" go={() => {}} />
  );
  const count = (type: string) => sent.filter(([sentType]) => sentType === type).length;
  return { view, sent, count, signed, errors, releasePreview: () => releasePreview() };
}

export const listing = (text = "What this project would load") =>
  settle(() => screen.queryByText(text) !== null, 5000, "the listing");
export const button = (name: string) => screen.queryByRole("button", { name });
export const dialogText = () => screen.queryByRole("alertdialog")?.textContent ?? "";
export async function click(name: string | RegExp, inDialog = false) {
  const scope = inDialog ? screen.queryByRole("alertdialog") : document.body;
  const target = scope ? within(scope as HTMLElement).queryByRole("button", { name }) : null;
  if (target) await act(async () => fireEvent.click(target));
  return target !== null;
}
/** Opens the setup's dialog: true when the button was there and the dialog showed. */
export async function open() {
  const shown = await settleMaybe(() => button("Set up Claude Code") !== null);
  if (!shown) return false;
  await click("Set up Claude Code");
  return settleMaybe(() => screen.queryByRole("alertdialog") !== null);
}
