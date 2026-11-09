import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { CardRunForm } = await import("../src/components/card/card-run-form.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #1568: on a project with no PR provider the card page asks the host to read it from the remote,
 * once it shows and again on "Check the remote again". Found: the provider is saved and Open PR
 * comes. No remote, or another service: the note says which.
 */
const finished = {
  id: "c1",
  projectId: "p1",
  title: "Cart screen",
  description: "",
  column: "review",
  validationNote: null,
  prUrl: null,
  prState: null,
  queued: false,
  sessionId: "s1",
  sessionStatus: "ended",
  worktreePath: "/w",
  branch: "card/cart-screen",
};
const project = (prProvider: string) => ({ id: "p1", name: "shop", prProvider });

type Answer = { outcome: string; host: string | null; prProvider?: string };

function setup(options: {
  language?: "en" | "pt-BR";
  provider?: string;
  detect?: boolean;
  /** What the host answers, one per ask. */
  answers?: Answer[];
}) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  (store as unknown as { update(p: object): void }).update({
    projects: { h1: [project(options.provider ?? "none")] },
  });
  const asked: string[] = [];
  const answers = [...(options.answers ?? [])];
  store.hostRequest = (async (_host: string, type: string, payload: { projectId?: string }) => {
    asked.push(`${type}:${payload.projectId ?? ""}`);
    if (type !== "project.detectProvider") return { ok: true, data: {} };
    const answer = answers.shift() ?? { outcome: "no_remote", host: null };
    return {
      ok: true,
      data: {
        project: project(answer.prProvider ?? "none"),
        outcome: answer.outcome,
        host: answer.host,
      },
    };
  }) as never;
  store.hostCommand = (async () => ({})) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <CardRunForm
        store={store}
        hostId="h1"
        card={finished as never}
        features={{ bg: true, watch: true, prDetect: options.detect ?? true }}
        tab="diff"
        canMerge={false}
        gateWaiting={false}
        onMerge={() => {}}
        arenaStart={null}
        onDiscarded={() => {}}
        onShowDiff={() => {}}
      />
    </TContext.Provider>,
  );
  return { store, asked };
}

const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const panel = () => document.querySelector('[data-slot="card-run"]')?.textContent ?? "";
const press = async (name: string | RegExp) => {
  const target = button(name);
  expect(target !== null).toBe(true);
  await act(async () => {
    fireEvent.click(target as HTMLElement);
  });
};

describe("card-pr-detect-ui: the card page reads the provider from the remote (#1568)", () => {
  test("no remote yet, then one added: Check the remote again finds GitHub and Open PR comes", async () => {
    const w = setup({
      answers: [
        { outcome: "no_remote", host: null },
        { outcome: "set", host: null, prProvider: "github" },
      ],
    });
    await settle(() => w.asked.length === 1);
    expect(w.asked).toEqual(["project.detectProvider:p1"]);
    expect(panel()).toContain("no PR provider set");
    expect(button("Open PR") === null).toBe(true);
    await press("Check the remote again");
    await settle(() => button("Open PR") !== null);
    expect(w.asked).toEqual(["project.detectProvider:p1", "project.detectProvider:p1"]);
    expect(panel()).not.toContain("no PR provider set");
    expect(w.store.getState().projects.h1?.[0]?.prProvider).toBe("github");
    // The change is said, so the button that appeared is not a surprise.
    expect(w.store.getState().notices.map((notice) => notice.text)).toEqual([
      "PR provider set from the remote: GitHub.",
    ]);
  });

  test("a remote on another service says so, with its host, and offers no Open PR", async () => {
    const w = setup({ answers: [{ outcome: "unsupported", host: "gitlab.com" }] });
    await settle(() => panel().includes("gitlab.com"));
    expect(panel()).toContain("not GitHub or Azure DevOps");
    expect(button("Open PR") === null).toBe(true);
    expect(w.store.getState().projects.h1?.[0]?.prProvider).toBe("none");
  });

  test("the same in Portuguese: Azure DevOps found", async () => {
    const w = setup({
      language: "pt-BR",
      answers: [{ outcome: "set", host: null, prProvider: "azure-devops" }],
    });
    await settle(() => button("Abrir PR") !== null);
    expect(w.store.getState().notices.map((notice) => notice.text)).toEqual([
      "Provedor de PR definido pelo remote: Azure DevOps.",
    ]);
  });

  test("the same in Portuguese: another service", async () => {
    const w = setup({
      language: "pt-BR",
      answers: [{ outcome: "unsupported", host: "gitlab.com" }],
    });
    await settle(() => panel().includes("gitlab.com"));
    expect(panel()).toContain("não é do GitHub nem do Azure DevOps");
    expect(w.asked).toHaveLength(1);
  });

  test("a host that cannot detect is not asked, and there is no button to ask", async () => {
    const w = setup({ detect: false });
    // timing: the effect that would ask runs on mount; nothing should come after it
    await act(async () => {});
    expect(w.asked).toEqual([]);
    expect(panel()).toContain("no PR provider set");
    expect(button("Check the remote again") === null).toBe(true);
  });

  test("a project that has a provider is not looked at", async () => {
    const w = setup({ provider: "github" });
    await act(async () => {});
    expect(w.asked).toEqual([]);
    expect(button("Open PR") !== null).toBe(true);
  });
});
