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

function setup(
  lang: "en" | "pt-BR",
  target: string,
  seen: ChangesResult,
  refuse?: { reason: string; params: Record<string, string> },
  refusePr?: { reason: string },
) {
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
      if (type === "changes.commit" && refuse) {
        return { ok: false, code: "invalid_state", message: "refused", ...refuse };
      }
      if (type === "changes.pr" && refusePr) {
        return { ok: false, code: "invalid_state", message: "refused", ...refusePr };
      }
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
    hooks: "These hooks run: pre-commit.",
    secret:
      "The app does not commit this file, since it may hold a secret: commit it from a terminal if it should go.",
    pushesPlain: `session/update-a-txt will be pushed to ${REMOTE}.`,
    prRefused: "Where the push goes changed since you looked: check it again, then open the PR.",
    prTitle: "PR title",
    others: "Other programs your git settings name may also run.",
    tooLarge: "Too large to commit from here.",
    files: "Files",
    needs: "Tick at least one file, and fill in the branch and the message.",
    nothing: "No file here can be committed from the app.",
    message: "Update a.txt",
    branch: "session/update-a-txt",
    pushes: `session/update-a-txt will be pushed to ${REMOTE}. The pre-push hook runs.`,
    body: "Files:\n- a.txt",
    confirmPr: "Open the PR with this text",
    noRemote: "This checkout has no origin to push to.",
    messageLabel: "Commit message",
    branchLabel: "New branch",
    many: "Update 2 files",
    noHooks: "No commit hook is set.",
    taken: "There is already a branch session/mine: pick another name.",
  },
  "pt-BR": {
    commit: "Fazer commit num branch novo",
    openPr: "Abrir PR",
    hooks: "Estes hooks rodam: pre-commit.",
    secret:
      "O app não faz commit deste arquivo, porque ele pode ter um segredo: faça o commit num terminal se ele deve ir.",
    pushesPlain: `session/atualiza-a-txt será enviado para ${REMOTE}.`,
    prRefused: "O destino do push mudou desde que você olhou: confira de novo e abra o PR.",
    prTitle: "Título do PR",
    others: "Outros programas que as configurações do git indicam também podem rodar.",
    tooLarge: "Grande demais para commitar por aqui.",
    files: "Arquivos",
    needs: "Marque ao menos um arquivo e preencha o branch e a mensagem.",
    nothing: "Nenhum arquivo daqui pode ser commitado pelo app.",
    message: "Atualiza a.txt",
    branch: "session/atualiza-a-txt",
    pushes: `session/atualiza-a-txt será enviado para ${REMOTE}. O hook pre-push roda.`,
    body: "Arquivos:\n- a.txt",
    confirmPr: "Abrir o PR com este texto",
    noRemote: "Este checkout não tem um origin para o push.",
    messageLabel: "Mensagem do commit",
    branchLabel: "Branch novo",
    many: "Atualiza 2 arquivos",
    noHooks: "Nenhum hook de commit configurado.",
    taken: "Já existe um branch session/mine: escolha outro nome.",
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
        document.getElementById(big?.getAttribute("aria-describedby") ?? "")?.textContent,
        screen.queryByRole("group", { name: n.files }) !== null,
        screen.queryByText(n.hooks) !== null,
        screen.queryByText(n.others) !== null,
        (branch as HTMLInputElement | null)?.value,
      ]).toEqual(["true", true, n.tooLarge, true, true, true, n.branch]);
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

    test(`${lang}: what the person unticks and renames is what goes, and a refused commit says why`, async () => {
      const seen = changes({ hooks: [] });
      seen.files = [seen.files[0], { ...seen.files[0], path: "b.txt", digest: "d-b" }] as never;
      const taken = { reason: "changes_commit_branch_taken", params: { branch: "session/mine" } };
      const sent = setup(lang, `session:${lang}-3`, seen, taken);
      await press(screen.queryByRole("button", { name: n.commit }));
      const message = screen.queryByRole("textbox", {
        name: n.messageLabel,
      }) as HTMLTextAreaElement;
      const drafted = message?.value;
      const branch = screen.queryByRole("textbox", { name: n.branchLabel }) as HTMLInputElement;
      const tick = (path: string) =>
        fireEvent.click(screen.queryByRole("checkbox", { name: path }) as HTMLElement);
      await act(async () => {
        tick("b.txt");
        tick("a.txt");
      });
      const needs = screen.queryByText(n.needs) !== null;
      await act(async () => {
        tick("a.txt");
        fireEvent.change(branch, { target: { value: "session/mine" } });
        fireEvent.change(message, { target: { value: "Fix the note" } });
      });
      const noHooks = screen.queryByText(n.noHooks) !== null;
      await press(
        within(screen.queryByRole("alertdialog") as HTMLElement).queryByRole("button", {
          name: n.commit,
        }),
      );
      const kept = screen.queryByRole("textbox", {
        name: n.branchLabel,
      }) as HTMLInputElement | null;
      expect([
        drafted,
        needs,
        noHooks,
        sent,
        screen.queryByRole("alert")?.textContent?.includes(n.taken) ?? false,
        kept?.value,
        screen.queryByRole("button", { name: n.openPr }) === null,
      ]).toEqual([
        n.many,
        true,
        true,
        [
          [
            "changes.commit",
            {
              target: `session:${lang}-3`,
              files: { "a.txt": "d-a" },
              message: "Fix the note",
              branch: "session/mine",
              confirm: true,
            },
          ],
        ],
        true,
        "session/mine",
        true,
      ]);
    });

    test(`${lang}: with nothing the app can commit, the button stays off and says why`, async () => {
      const seen = changes();
      seen.files = seen.files.filter((file) => file.path === "big.bin");
      setup(lang, `session:${lang}-4`, seen);
      const commit = screen.queryByRole("button", { name: n.commit });
      expect([commit?.hasAttribute("disabled"), screen.queryByText(n.nothing) !== null]).toEqual([
        true,
        true,
      ]);
    });

    test(`${lang}: a file the app does not commit says why, and a refused PR keeps the text the person wrote`, async () => {
      const seen = changes({ hooks: ["pre-commit"] });
      seen.files = [seen.files[0], { ...seen.files[0], path: ".env", digest: undefined }] as never;
      setup(lang, `session:${lang}-5`, seen, undefined, { reason: "changes_pr_remote" });
      await press(screen.queryByRole("button", { name: n.commit }));
      const env = screen.queryByRole("checkbox", { name: ".env" }) as HTMLInputElement | null;
      const why = document.getElementById(env?.getAttribute("aria-describedby") ?? "")?.textContent;
      await press(
        within(screen.queryByRole("alertdialog") as HTMLElement).queryByRole("button", {
          name: n.commit,
        }),
      );
      await press(screen.queryByRole("button", { name: n.openPr }));
      const plain = screen.queryByText(n.pushesPlain) !== null;
      await act(async () => {
        fireEvent.change(screen.queryByRole("textbox", { name: n.prTitle }) as HTMLElement, {
          target: { value: "My title" },
        });
      });
      await press(screen.queryByRole("button", { name: n.confirmPr }));
      const title = screen.queryByRole("textbox", { name: n.prTitle }) as HTMLInputElement | null;
      expect([
        why,
        plain,
        title?.value,
        screen.queryByRole("alert")?.textContent?.includes(n.prRefused) ?? false,
      ]).toEqual([n.secret, true, "My title", true]);
    });
  }
});
