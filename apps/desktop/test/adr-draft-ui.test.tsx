import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { KnowledgeEntry } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { AdrDraftDialog } = await import("../src/components/session/adr-draft-dialog.tsx");
const { RecapPanel } = await import("../src/ui/RecapPanel.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** Issue #1039: a decision record drafted from a session's summary, edited, and saved as an ADR. */
const SUMMARY = "Asked: pick a database\nDone: moved the store to SQLite\nFiles: store.ts";

const saved: KnowledgeEntry = {
  path: "docs/adr/0004-use-sqlite.md",
  title: "Use SQLite",
  type: "adr",
  status: "transitional",
  supersedes: null,
  bytes: 90,
  changedAt: "2026-11-08T10:00:00.000Z",
  problems: [],
  warnings: [],
  hash: "h",
};

type Answer = { ok: true; data: unknown } | { ok: false; [key: string]: unknown };

function setup(answer: Answer = { ok: true, data: saved }, language: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const sent: Array<[string, unknown]> = [];
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    return answer;
  }) as never;
  let closed = 0;
  const view = (
    <TContext.Provider value={store.i18n.t}>
      <AdrDraftDialog
        store={store}
        hostId="h1"
        path="/work/api"
        summary={SUMMARY}
        onClose={() => {
          closed++;
        }}
      />
    </TContext.Provider>
  );
  return { view, sent, closed: () => closed };
}

const titleBox = () => screen.getByLabelText("Decision title") as HTMLInputElement;
const bodyBox = () => screen.getByLabelText("Decision record text") as HTMLTextAreaElement;
const save = () => screen.getByRole("button", { name: "Save as ADR" }) as HTMLButtonElement;
const type = async (field: HTMLElement, value: string) => {
  await act(async () => {
    fireEvent.change(field, { target: { value } });
  });
};

describe("adr-draft-ui: a decision record from a session summary (#1039)", () => {
  test("the dialog starts from the summary, and saving waits for a title", async () => {
    render(setup().view);
    expect([bodyBox().value, titleBox().value, save().disabled]).toEqual([SUMMARY, "", true]);
    await type(titleBox(), "Use SQLite");
    expect(save().disabled).toBe(false);
  });

  test("saving sends the edited text as the body of a new ADR and says which file was written", async () => {
    const { view, sent, closed } = setup();
    render(view);
    await type(titleBox(), "  Use SQLite ");
    await type(bodyBox(), "## Context\nOne store.");
    await act(async () => {
      fireEvent.click(save());
    });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeNull());
    expect(sent).toEqual([
      [
        "knowledge.create",
        { path: "/work/api", kind: "adr", title: "Use SQLite", body: "## Context\nOne store." },
      ],
    ]);
    expect(screen.getByRole("status").textContent).toContain("docs/adr/0004-use-sqlite.md");
    expect(closed()).toBe(0);
  });

  test("a refusal is said, and the text stays for another try", async () => {
    const { view } = setup({
      ok: false,
      code: "file_conflict",
      message: "docs/adr/x.md already exists",
      reason: "knowledge_exists",
    });
    render(view);
    await type(titleBox(), "Use SQLite");
    await type(bodyBox(), "## Context\nOne store.");
    await act(async () => {
      fireEvent.click(save());
    });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
    expect([
      screen.getByRole("alert").textContent?.includes("Could not save"),
      bodyBox().value,
    ]).toEqual([true, "## Context\nOne store."]);
  });

  test("the labels are in the person's language", async () => {
    render(setup({ ok: true, data: saved }, "pt-BR").view);
    expect(screen.queryByLabelText("Título da decisão")).not.toBeNull();
  });
});

const RECAP = {
  asked: "pick a database",
  done: "moved the store to SQLite",
  files: ["store.ts"],
  filesMore: 0,
  costUsd: null,
  question: null,
  state: "idle",
  source: "transcript" as const,
};

function recapView(features: string[], libraryPath: string | undefined) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.sessionRecap = (async () => RECAP) as never;
  const sent: Array<[string, unknown]> = [];
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    return { ok: true, data: saved };
  }) as never;
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: { daemonVersion: "x", features },
        sessions: [],
      },
    ],
  } as never as ReturnType<typeof store.getState>;
  store.getState = () => state;
  const view = (
    <TContext.Provider value={store.i18n.t}>
      <RecapPanel
        store={store}
        hostId="h1"
        claudeSessionId="s1"
        {...(libraryPath ? { libraryPath } : {})}
      />
    </TContext.Provider>
  );
  return { view, sent };
}

const draftButton = () => screen.queryByRole("button", { name: "Draft ADR" });

describe("adr-draft-ui: the session summary offers the draft (#1039)", () => {
  test("the button is there when the host can summarize and write documents and the project is known", async () => {
    render(recapView(["summary", "knowledgeCreate"], "/work/api").view);
    await waitFor(() => expect(draftButton()).not.toBeNull());
    await act(async () => {
      fireEvent.click(draftButton() as HTMLElement);
    });
    expect(bodyBox().value).toContain("moved the store to SQLite");
  });

  test("no button without a project folder, or on a host that cannot write documents", async () => {
    render(recapView(["summary", "knowledgeCreate"], undefined).view);
    await waitFor(() => expect(screen.queryByText(/moved the store to SQLite/)).not.toBeNull());
    expect(draftButton()).toBeNull();
    cleanup();
    render(recapView(["summary"], "/work/api").view);
    await waitFor(() => expect(screen.queryByText(/moved the store to SQLite/)).not.toBeNull());
    expect(draftButton()).toBeNull();
  });
});
