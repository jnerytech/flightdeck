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

type Answer = { outcome: string; host: string | null; prProvider?: string; refuse?: boolean };

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
    if (answer.refuse) return { ok: false, code: "offline", message: "connection lost" };
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
    expect(panel()).toContain("not on github.com or Azure DevOps");
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
    expect(panel()).toContain("não está no github.com nem no Azure DevOps");
    expect(w.asked).toHaveLength(1);
  });

  test("a host that cannot detect is not asked, and there is no button to ask", async () => {
    const w = setup({ detect: false });
    await settle(() => panel().includes("no PR provider set"));
    // timing: a negative: the ask, if the card made one, goes out on mount; give it the time to reach the host
    await act(async () => Bun.sleep(30));
    expect(w.asked).toEqual([]);
    expect(button("Check the remote again") === null).toBe(true);
  });

  test("a project that has a provider is not looked at", async () => {
    const w = setup({ provider: "github" });
    await settle(() => button("Open PR") !== null);
    // timing: a negative: the ask, if the card made one, goes out on mount; give it the time to reach the host
    await act(async () => Bun.sleep(30));
    expect(w.asked).toEqual([]);
  });

  test("a press always answers: no remote found yet is said, a host that cannot be reached is an error", async () => {
    const w = setup({
      answers: [
        { outcome: "no_remote", host: null },
        { outcome: "no_remote", host: null },
        { outcome: "no_remote", host: null, refuse: true },
      ],
    });
    await settle(() => w.asked.length === 1);
    // Looking when the card shows is quiet: nobody asked.
    expect(w.store.getState().notices).toEqual([]);
    await press("Check the remote again");
    expect(w.store.getState().notices.map((notice) => notice.text)).toEqual([
      "No remote found yet: add one with git remote add origin <url>, then check again.",
    ]);
    await press("Check the remote again");
    const notices = w.store.getState().notices;
    expect(notices).toHaveLength(2);
    expect(notices[1]?.kind).toBe("error");
    expect(notices[1]?.text ?? "").toContain("connection lost");
  });

  test("when the provider is found, the focus lands on the button that takes the place of the one pressed", async () => {
    const w = setup({
      answers: [
        { outcome: "no_remote", host: null },
        { outcome: "set", host: null, prProvider: "github" },
      ],
    });
    await settle(() => w.asked.length === 1);
    (button("Check the remote again") as HTMLElement).focus();
    await press("Check the remote again");
    await settle(() => button("Open PR") !== null);
    expect(document.activeElement === button("Open PR")).toBe(true);
  });

  test("a remote that is no host name, or git unable to read the repository, is said as it is", async () => {
    const elsewhere = setup({ answers: [{ outcome: "unsupported", host: null }] });
    await settle(() => panel().includes("not on github.com or Azure DevOps"));
    expect(panel()).not.toContain("null");
    expect(elsewhere.asked).toHaveLength(1);
    cleanup();
    setup({ answers: [{ outcome: "unreadable", host: null }] });
    await settle(() => panel().includes("could not read"));
    expect(panel()).not.toContain("git remote add");
  });

  test("an enterprise or other host is not GitHub from the name alone: the note says to set it by hand", async () => {
    setup({ answers: [{ outcome: "unsupported", host: "git.corp.example.com" }] });
    await settle(() => panel().includes("git.corp.example.com"));
    expect(panel()).toContain("GitHub Enterprise");
  });

  test("a project the app has not listed yet is added when the host answers", async () => {
    const w = setup({ answers: [{ outcome: "set", host: null, prProvider: "github" }] });
    (w.store as unknown as { update(p: object): void }).update({ projects: { h1: [] } });
    await w.store.detectPrProvider("h1", "p1");
    expect(w.store.getState().projects.h1?.map((one) => one.id)).toEqual(["p1"]);
  });
});
