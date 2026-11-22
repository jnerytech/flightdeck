import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore, onWire } from "../fake-host.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { DiffView } = await import("../../src/features/review/diff-view.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");
const { PrComments } = await import("../../src/features/review/pr-comments.tsx");
const { prCommentsByPath } = await import("../../src/features/review/domain/review.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Lang = "en" | "pt-BR";

const file = (path: string) =>
  ({
    path,
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    uncommitted: false,
    binary: false,
    hunks: [],
  }) as never;

const comment = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  path: "src/a.ts",
  line: 3,
  author: "ana",
  authorAssociation: "MEMBER",
  authorIdentity: null,
  body: `body ${id}`,
  resolved: false,
  kind: "inline",
  ...over,
});

// #4228: the diff says which files carry PR comments, and the count leads to the first one.
describe("the PR comments are marked on the files of the diff (#4228)", () => {
  test("the comments are grouped by file: a count and the first id; a review's summary has no file", () => {
    expect(
      prCommentsByPath([
        comment("k1"),
        comment("k2", { line: 9 }),
        comment("k3", { path: "src/b.ts" }),
        comment("k4", { path: null, line: null, kind: "review" }),
      ] as never),
    ).toEqual({
      "src/a.ts": { count: 2, firstId: "k1" },
      "src/b.ts": { count: 1, firstId: "k3" },
    });
  });

  const LABEL = {
    en: (n: number) => `${n} PR comments on src/a.ts`,
    "pt-BR": (n: number) => `${n} comentários do PR em src/a.ts`,
  } as const;
  for (const lang of ["en", "pt-BR"] as const) {
    test(`${lang}: a file with comments shows their count and moves to the first one; a file with none shows nothing`, () => {
      render(
        <TContext.Provider value={translator(lang)}>
          <DiffView
            files={[file("src/a.ts"), file("src/c.ts")]}
            mode="unified"
            selection={null}
            composer={null}
            prComments={{ "src/a.ts": { count: 2, firstId: "k1" } }}
          />
          <p id="prc:k1" tabIndex={-1}>
            the first comment
          </p>
        </TContext.Provider>,
      );
      const mark = screen.queryByRole("button", { name: LABEL[lang](2) }) as HTMLElement;
      expect(mark).not.toBeNull();
      expect(screen.queryAllByRole("button", { name: /PR/ })).toHaveLength(1);
      fireEvent.click(mark);
      expect(document.activeElement?.id).toBe("prc:k1");
    });
  }

  async function read(lang: Lang) {
    const told: unknown[] = [];
    const { store } = await fakeHostStore(
      { "pr.comments": onWire(async () => ({ comments: [comment("k1"), comment("k2")] })) },
      { language: lang },
    );
    render(
      <TContext.Provider value={translator(lang)}>
        <PrComments
          store={store}
          hostId="h"
          cardId="c1"
          moment="m"
          onRead={(list) => told.push(list.map((c) => c.id))}
        />
      </TContext.Provider>,
    );
    expect(await settleMaybe(() => screen.queryByText("body k1") !== null)).toBe(true);
    return told;
  }

  test("the comments tell what they read, and each one can be reached by its id", async () => {
    const told = await read("en");
    expect(told).toEqual([["k1", "k2"]]);
    expect(document.getElementById("prc:k1")?.textContent).toContain("body k1");
  });

  test("a read that fails or a list that goes away clears what the diff marks", async () => {
    const answers: unknown[] = [
      { comments: [comment("k1")] },
      new RequestError("unavailable", "no index"),
      { comments: [comment("k1")] },
    ];
    const { store } = await fakeHostStore({
      "pr.comments": onWire(async () => answers.shift()),
    });
    const told: string[][] = [];
    const tree = (moment: string) => (
      <TContext.Provider value={translator("en")}>
        <PrComments
          store={store}
          hostId="h"
          cardId="c1"
          moment={moment}
          onRead={(list) => told.push(list.map((c) => c.id))}
        />
      </TContext.Provider>
    );
    const view = render(tree("m1"));
    expect(await settleMaybe(() => told.length === 1)).toBe(true);
    view.rerender(tree("m2"));
    expect(await settleMaybe(() => told.length === 2)).toBe(true);
    expect(told).toEqual([["k1"], []]);
    view.rerender(tree("m3"));
    expect(await settleMaybe(() => told.length === 3)).toBe(true);
    view.unmount();
    expect(told).toEqual([["k1"], [], ["k1"], []]);
  });

  test("a path in the diff twice (committed and not) carries one mark", () => {
    render(
      <TContext.Provider value={translator("en")}>
        <DiffView
          files={[
            file("src/a.ts"),
            { ...(file("src/a.ts") as object), uncommitted: true } as never,
          ]}
          mode="unified"
          selection={null}
          composer={null}
          prComments={{ "src/a.ts": { count: 2, firstId: "k1" } }}
        />
      </TContext.Provider>,
    );
    expect(screen.queryAllByRole("button", { name: /PR comments on src\/a\.ts/ })).toHaveLength(1);
  });
});
