import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore, onWire } from "../fake-host.ts";
import { settle, uiIdle } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");
const { CardReview } = await import("../../src/features/review/card-review.tsx");
const { PrComments } = await import("../../src/features/review/pr-comments.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Lang = "en" | "pt-BR";
const WORDS = {
  en: {
    update: "Update from the base",
    merge: "Merge and archive",
    upToDate: "Already up to date with main.",
    nothing: "Nothing ahead of main to merge.",
    empty: "No comments on the PR.",
    failed: "Could not read the PR comments.",
    retry: "Try again",
  },
  "pt-BR": {
    update: "Atualizar com a base",
    merge: "Merge e arquivar",
    upToDate: "Já está em dia com main.",
    nothing: "Nada à frente de main para entrar no merge.",
    empty: "Nenhum comentário no PR.",
    failed: "Não consegui ler os comentários do PR.",
    retry: "Tentar de novo",
  },
} as const;

async function review(lang: Lang, position: { ahead: number; behind: number }) {
  const { store } = await fakeHostStore({}, { language: lang });
  render(
    <TContext.Provider value={translator(lang)}>
      <CardReview
        store={store}
        hostId="h"
        card={{ id: "c1", prUrl: null } as never}
        changes={{ base: "main", position } as never}
        refresh={async () => {}}
      />
    </TContext.Provider>,
  );
}

const button = (name: string) => screen.queryByRole("button", { name }) as HTMLButtonElement | null;

describe("a card's place against its base says why a button is disabled (#3894)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    const w = WORDS[lang];
    test(`${lang}: no commits behind or ahead gives a reason beside each button`, async () => {
      await review(lang, { ahead: 0, behind: 0 });
      expect([button(w.update)?.disabled, button(w.merge)?.disabled]).toEqual([true, true]);
      expect(screen.queryByText(w.upToDate)).not.toBeNull();
      expect(screen.queryByText(w.nothing)).not.toBeNull();
    });

    test(`${lang}: commits behind and ahead leave both buttons on and say nothing`, async () => {
      await review(lang, { ahead: 2, behind: 1 });
      expect([button(w.update)?.disabled, button(w.merge)?.disabled]).toEqual([false, false]);
      expect(screen.queryByText(w.upToDate)).toBeNull();
      expect(screen.queryByText(w.nothing)).toBeNull();
    });
  }
});

describe("the PR comments say when the read failed (#3894)", () => {
  const comment = { id: "k1", author: "ana", body: "ajuste", resolved: false, path: null };

  async function comments(lang: Lang, answers: Array<Error | { comments: unknown[] }>) {
    const queue = [...answers];
    const { store } = await fakeHostStore(
      {
        "pr.comments": onWire(async () => queue.shift() ?? { comments: [] }),
      },
      { language: lang },
    );
    render(
      <TContext.Provider value={translator(lang)}>
        <PrComments store={store} hostId="h" cardId="c1" moment="m" />
      </TContext.Provider>,
    );
    await uiIdle();
  }

  for (const lang of ["en", "pt-BR"] as const) {
    const w = WORDS[lang];
    test(`${lang}: a refused read shows the error and Try again, never the empty text`, async () => {
      await comments(lang, [new RequestError("unavailable", "gh failed"), { comments: [comment] }]);
      await settle(() => screen.queryByText(w.failed) !== null);
      expect(screen.queryByText(w.failed)).not.toBeNull();
      expect(screen.queryByText(w.empty)).toBeNull();
      await act(async () => {
        fireEvent.click(button(w.retry) as HTMLButtonElement);
      });
      await settle(() => screen.queryByText("ajuste") !== null);
      expect(screen.queryByText(w.failed)).toBeNull();
      expect(screen.queryByText("ajuste")).not.toBeNull();
    });
  }

  test("a PR that really has no comments still says so", async () => {
    await comments("en", [{ comments: [] }]);
    await settle(() => screen.queryByText(WORDS.en.empty) !== null);
    expect(screen.queryByText(WORDS.en.empty)).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
