import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ChangesResult } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { fakeAssistant } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionFinish } = await import("../src/components/session/session-finish.tsx");
const { AssistantController } = await import("../src/lib/assistant.ts");
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #1133, slice A1: a plain session's Changes ends in a commit on a new branch (the files the
 * person ticks, as they saw them, with the hooks that will run named) and then its PR (the title
 * and description the person confirmed, pushed where they saw).
 */
const REMOTE = "https://github.com/acme/app.git";

function changes(over: Partial<ChangesResult> = {}): ChangesResult {
  const file = (path: string, digest: string) => ({
    path,
    status: "modified" as const,
    binary: false,
    additions: 1,
    deletions: 0,
    digest,
    hunks: [],
  });
  return {
    target: "session:s1",
    root: "/repo",
    base: null,
    position: null,
    files: [file("a.txt", "d-a"), file("big.bin", "too-large")],
    hooks: ["pre-commit", "pre-push"],
    remote: REMOTE,
    ...over,
  } as ChangesResult;
}

function setup(lang: "en" | "pt-BR", target: string, seen: ChangesResult) {
  const sent: Array<[string, unknown]> = [];
  const items = new Map<string, string>();
  const controller = new AssistantController({
    storage: { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v) },
    api: fakeAssistant({ supported: false }).assistant,
    hosts: () => [{ id: "h1", online: true, assistant: true }],
    secrets: () => [],
    language: () => lang,
    request: async () => ({ ok: false, code: "x", message: "x" }) as never,
  });
  const store = {
    assistant: controller,
    openAssistantSettings: () => {},
    hostRequest: async (_hostId: string, type: string, payload: unknown) => {
      sent.push([type, payload]);
      if (type === "changes.commit") {
        const { branch } = payload as { branch: string };
        return { ok: true, data: { branch, base: "main", commit: "c0ffee", files: ["a.txt"] } };
      }
      return {
        ok: true,
        data: { url: "https://github.com/acme/app/pull/7", branch: "b", base: "main" },
      };
    },
    success: () => {},
  } as unknown as InstanceType<typeof AppStore>;
  render(
    <TContext.Provider value={translator(lang)}>
      <TooltipProvider>
        <SessionFinish
          store={store}
          hostId="h1"
          target={target}
          changes={{ ...seen, target }}
          refresh={async () => {}}
        />
      </TooltipProvider>
    </TContext.Provider>,
  );
  return sent;
}

const press = async (button: HTMLElement | null) => {
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const NAMES = {
  en: {
    commit: "Commit on a new branch",
    openPr: "Open PR",
    hooks: "These hooks run: pre-commit, pre-push.",
    others: "Other programs your git settings name may also run.",
    tooLarge: "big.bin is too large to commit from here.",
    message: "Update a.txt",
    branch: "session/update-a-txt",
    pushes: `Pushes session/update-a-txt to ${REMOTE}. The pre-push hook runs.`,
    body: "Files:\n- a.txt",
    confirmPr: "Open the PR with this text",
    noRemote: "This checkout has no origin to push to.",
  },
  "pt-BR": {
    commit: "Fazer commit num branch novo",
    openPr: "Abrir PR",
    hooks: "Estes hooks rodam: pre-commit, pre-push.",
    others: "Outros programas que as configurações do git indicam também podem rodar.",
    tooLarge: "big.bin é grande demais para o commit por aqui.",
    message: "Atualiza a.txt",
    branch: "session/atualiza-a-txt",
    pushes: `Envia session/atualiza-a-txt para ${REMOTE}. O hook pre-push roda.`,
    body: "Arquivos:\n- a.txt",
    confirmPr: "Abrir o PR com este texto",
    noRemote: "Este checkout não tem um origin para o push.",
  },
} as const;

describe("session-finish-ui: a plain session's commit on a new branch, then its PR (#1133)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    const n = NAMES[lang];

    test(`${lang}: the ticked files go as seen, the hooks are named, and the PR goes where the person saw`, async () => {
      const sent = setup(lang, `session:${lang}-1`, changes());
      expect(screen.queryByRole("button", { name: n.openPr })).toBeNull();
      await press(screen.queryByRole("button", { name: n.commit }));
      const big = screen.queryByRole("checkbox", { name: "big.bin" }) as HTMLInputElement | null;
      const a = screen.queryByRole("checkbox", { name: "a.txt" }) as HTMLInputElement | null;
      const branch = screen.queryByRole("textbox", {
        name: lang === "en" ? "New branch" : "Branch novo",
      });
      expect([
        a?.getAttribute("aria-checked") ?? String(a?.checked),
        big?.hasAttribute("disabled") ?? big?.disabled,
        screen.queryByText(n.tooLarge) !== null,
        screen.queryByText(n.hooks) !== null,
        screen.queryByText(n.others) !== null,
        (branch as HTMLInputElement | null)?.value,
      ]).toEqual(["true", true, true, true, true, n.branch]);
      await press(
        within(screen.queryByRole("alertdialog") as HTMLElement).queryByRole("button", {
          name: n.commit,
        }),
      );
      await press(screen.queryByRole("button", { name: n.openPr }));
      expect(screen.queryByText(n.pushes)).not.toBeNull();
      await press(screen.queryByRole("button", { name: n.confirmPr }));
      expect(sent).toEqual([
        [
          "changes.commit",
          {
            target: `session:${lang}-1`,
            files: { "a.txt": "d-a" },
            message: n.message,
            branch: n.branch,
            confirm: true,
          },
        ],
        [
          "changes.pr",
          {
            target: `session:${lang}-1`,
            title: n.message,
            body: n.body,
            remote: REMOTE,
            confirm: true,
          },
        ],
      ]);
    });

    test(`${lang}: with no origin, Open PR stays off and says why`, async () => {
      const seen = changes();
      delete seen.remote;
      setup(lang, `session:${lang}-2`, seen);
      await press(screen.queryByRole("button", { name: n.commit }));
      await press(
        within(screen.queryByRole("alertdialog") as HTMLElement).queryByRole("button", {
          name: n.commit,
        }),
      );
      const open = screen.queryByRole("button", { name: n.openPr });
      expect([open?.hasAttribute("disabled"), screen.queryByText(n.noRemote) !== null]).toEqual([
        true,
        true,
      ]);
    });
  }
});
