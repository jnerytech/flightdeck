import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { uiIdle } from "./wait.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ChangesPanel } = await import("../src/ui/ChangesPanel.tsx");
const { DiffView } = await import("../src/ui/DiffView.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

import type { AppStore } from "../src/lib/app-store.ts";

afterEach(cleanup);

const file = (path: string, extra: Record<string, unknown> = {}) => ({
  path,
  oldPath: null,
  status: "added",
  additions: 1,
  deletions: 0,
  uncommitted: true,
  binary: false,
  hunks: [{ header: "@@ -0,0 +1 @@", lines: [{ op: "+", text: "plain line" }] }],
  ...extra,
});

/** What a daemon that knows #509 sends for a new `.env.local`: the mark, no lines, no counts. */
const secret = file(".env.local", { secret: true, additions: 0, hunks: [] });

const panel = async (language: "en" | "pt-BR") => {
  const store = {
    hostRequest: async () => ({
      ok: true,
      data: { target: "session:abc", root: "/repo", base: null, files: [secret, file("a.txt")] },
    }),
    hostCommand: async () => null,
    watchChanges: () => () => {},
    canOpenPaths: () => false,
    i18n: { t: translator(language) },
  } as unknown as AppStore;
  render(
    <TContext.Provider value={translator(language)}>
      <ChangesPanel store={store} hostId="h" target="session:abc" />
    </TContext.Provider>,
  );
  await uiIdle();
};

describe("review-secrets-ui: a credential file shows as hidden (#509)", () => {
  test("the list marks it hidden and offers no editor for it; other files keep theirs", async () => {
    await panel("en");
    const row = screen.queryByText(".env.local", { selector: "li span" })?.closest("li") ?? null;
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).queryByText("Hidden")).not.toBeNull();
    expect(within(row as HTMLElement).queryByText("+0 −0")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit file .env.local" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit file a.txt" })).not.toBeNull();
    expect(
      screen.queryByText(
        "Hidden: this file may hold a credential, so Flightdeck does not show its content.",
      ),
    ).not.toBeNull();
  });

  test("in Portuguese too", async () => {
    await panel("pt-BR");
    const row = screen.queryByText(".env.local", { selector: "li span" })?.closest("li") ?? null;
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).queryByText("Oculto")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Editar arquivo .env.local" })).toBeNull();
    expect(
      screen.queryByText(
        "Oculto: este arquivo pode guardar uma credencial, então o Flightdeck não mostra o conteúdo.",
      ),
    ).not.toBeNull();
  });

  test("the diff shows the note in place of lines, even if a daemon sent some", () => {
    const leaky = { ...secret, hunks: file("x").hunks };
    render(
      <TContext.Provider value={translator("en")}>
        <DiffView
          files={[leaky as never]}
          mode="unified"
          selection={null}
          onPick={() => {}}
          composer={null}
        />
      </TContext.Provider>,
    );
    expect(screen.queryByText(/Hidden: this file may hold a credential/)).not.toBeNull();
    expect(screen.queryByText("plain line")).toBeNull();
  });
});
