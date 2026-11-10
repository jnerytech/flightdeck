import { afterEach, describe, expect, test } from "bun:test";
import { BUILTIN_TEMPLATES } from "../../daemon/src/templates/builtin.ts";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { HomeView } = await import("../src/components/simple/home-view.tsx");

afterEach(cleanup);

function view(
  over: {
    tasks?: Array<{
      sessionId: string;
      title: string;
      state: "working" | "waiting" | "done" | "stopped" | "failed";
    }>;
    lang?: "en" | "pt-BR";
    canPickFolder?: boolean;
    templates?: typeof BUILTIN_TEMPLATES;
    status?: "online" | "offline" | "connecting" | "unauthorized" | "incompatible";
    folders?: string[] | null;
  } = {},
) {
  const calls: string[] = [];
  render(
    <HomeView
      templates={over.templates ?? BUILTIN_TEMPLATES}
      tasks={over.tasks ?? []}
      t={translator(over.lang ?? "en", "simple")}
      canPickFolder={over.canPickFolder ?? false}
      onPickFolder={async () => "/work/Notes"}
      onStart={async (id, values) => void calls.push(`start:${id}:${JSON.stringify(values)}`)}
      onOpenTask={(id) => void calls.push(`open:${id}`)}
      where={{
        hostName: "Office PC",
        status: over.status ?? "online",
        folders: over.folders === undefined ? ["/work"] : over.folders,
        onOpenSettings: () => void calls.push("settings"),
      }}
    />,
  );
  return calls;
}

describe("home-simple-ui: where simple mode begins", () => {
  test("Given the host's templates, Then each is a card with its title and description, in the language in use", () => {
    view();
    for (const template of BUILTIN_TEMPLATES) {
      expect(screen.getByRole("button", { name: new RegExp(template.title.en) })).toBeTruthy();
    }
    expect(screen.getByText(BUILTIN_TEMPLATES[0]?.description.en as string)).toBeTruthy();
    cleanup();
    view({ lang: "pt-BR" });
    expect(screen.getByRole("button", { name: /Resumir uma pasta/ })).toBeTruthy();
  });

  test("Given no task yet, Then the three steps of a task show, and no waiting strip", () => {
    view();
    const steps = screen.getByRole("list", { name: "How a task goes" });
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "Pick a card above.",
      "Answer the few questions it asks.",
      "Get what it made in the Flightdeck results folder, inside the folder you picked.",
    ]);
    expect(screen.queryByRole("region", { name: "Waiting for your answer" })).toBeNull();
  });

  test("Given tasks, Then the recent ones list with their state, and a click opens one", async () => {
    const calls = view({
      tasks: [
        { sessionId: "s1", title: "Summarise Notes", state: "done" },
        { sessionId: "s2", title: "Draft report", state: "working" },
      ],
    });
    const list = screen.getByRole("list", { name: "Your recent tasks" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Done")).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(list).getByRole("button", { name: "Open Summarise Notes" }));
    });
    expect(calls).toEqual(["open:s1"]);
  });

  test("Given a task waiting for an answer, Then it is on top, in a strip of its own", async () => {
    const calls = view({
      tasks: [
        { sessionId: "s1", title: "Summarise Notes", state: "done" },
        { sessionId: "s2", title: "Draft report", state: "waiting" },
      ],
    });
    const strip = screen.getByRole("region", { name: "Waiting for your answer" });
    await act(async () => {
      fireEvent.click(within(strip).getByRole("button", { name: "Open Draft report" }));
    });
    expect(calls).toEqual(["open:s2"]);
  });

  test("Given a template, When its card is pressed, Then it asks what it needs, and starts only when that is filled in", async () => {
    const calls = view();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Summarise a folder/ }));
    });
    const dialog = screen.getByRole("dialog", { name: "Summarise a folder" });
    const start = within(dialog).getByRole("button", {
      name: "Start this task",
    }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(within(dialog).getByText("Fill in what is asked above.")).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Which folder?" }), {
      target: { value: "/work/Notes" },
    });
    expect(start.disabled).toBe(false);
    // The optional field may stay empty.
    await act(async () => {
      fireEvent.click(start);
    });
    expect(calls).toEqual(['start:summarise-folder:{"folder":"/work/Notes"}']);
  });

  test("Given the folder dialog, When Choose folder is pressed, Then the folder fills in", async () => {
    view({ canPickFolder: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Summarise a folder/ }));
    });
    const dialog = screen.getByRole("dialog", { name: "Summarise a folder" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Choose folder…" }));
    });
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("textbox", { name: "Which folder?" }) as HTMLInputElement).value,
      ).toBe("/work/Notes"),
    );
  });

  test("Given a choice field, Then its options are the template's, in the language in use", async () => {
    view({ lang: "pt-BR" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Revisar um documento/ }));
    });
    const dialog = screen.getByRole("dialog", { name: "Revisar um documento" });
    const select = within(dialog).getByRole("combobox", {
      name: "Com que profundidade?",
    }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Escolher…",
      "Uma olhada rápida",
      "Cuidadosa",
    ]);
  });

  test("Given a host with no templates, Then it says so", () => {
    view({ templates: [] });
    expect(screen.getByText("This computer has no ready-made tasks yet.")).toBeTruthy();
  });

  test("Given a template with a choice and a card opened, When the choice is made and the dialog is dismissed, Then the form answers and closes", async () => {
    const withChoice: typeof BUILTIN_TEMPLATES = [
      {
        id: "tone",
        title: { en: "Rewrite in a tone", "pt-BR": "Reescrever num tom" },
        description: { en: "Changes the tone.", "pt-BR": "Muda o tom." },
        icon: "sparkles",
        fields: [
          {
            id: "tone",
            kind: "choice",
            label: { en: "Which tone?", "pt-BR": "Qual tom?" },
            choices: [
              { id: "warm", label: { en: "Warm", "pt-BR": "Caloroso" } },
              { id: "formal", label: { en: "Formal", "pt-BR": "Formal" } },
            ],
          },
        ],
        prompt: { en: "Rewrite in a {tone} tone.", "pt-BR": "Reescreva num tom {tone}." },
        preset: "read_only",
        planFirst: false,
      },
    ];
    const calls = view({ templates: withChoice });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Rewrite in a tone/ }));
    });
    const start = () =>
      screen.getByRole("button", { name: "Start this task" }) as HTMLButtonElement;
    expect(start().disabled).toBe(true);
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "Which tone?" }), {
        target: { value: "warm" },
      });
    });
    await waitFor(() => expect(start().disabled).toBe(false));
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls).toEqual([]);
  });

  test("Given the first screen, Then it says what a task is, that it asks before changing anything and where results go, in both languages", () => {
    view();
    expect(screen.queryByText(/Claude works on your files on this computer/)).not.toBeNull();
    expect(screen.queryByText(/Flightdeck results/)).not.toBeNull();
    cleanup();
    view({ lang: "pt-BR" });
    expect(
      screen.queryByText(/O Claude trabalha nos seus arquivos neste computador/),
    ).not.toBeNull();
    expect(screen.queryByRole("list", { name: "Como uma tarefa acontece" })).not.toBeNull();
  });

  test("Given a card, Then it says what it asks for and whether it only reads or may change files", () => {
    view();
    const summarise = screen.getByRole("button", { name: /Summarise a folder/ });
    expect(summarise.textContent).toContain("Questions: Which folder?");
    expect(summarise.textContent).toContain("Only reads your files.");
    const draft = screen.getByRole("button", { name: /Draft a report/ });
    expect(draft.textContent).toContain(
      "Questions: Folder with the files, What is the report about?",
    );
    expect(draft.textContent).toContain("Asks before it changes anything.");
    cleanup();
    view({ lang: "pt-BR" });
    expect(screen.getByRole("button", { name: /Resumir uma pasta/ }).textContent).toContain(
      "Perguntas: Qual pasta?",
    );
  });

  test("Given the host, Then Home says which computer the tasks run on and that it is connected", () => {
    view();
    expect(screen.queryByText("Tasks run on Office PC (connected).")).not.toBeNull();
    expect(screen.queryByRole("alert") === null).toBe(true);
    cleanup();
    view({ lang: "pt-BR" });
    expect(screen.queryByText("As tarefas rodam em Office PC (conectado).")).not.toBeNull();
  });

  test("Given the host, Then the first card comes before the line about where tasks run, so it stays in a phone's window", () => {
    view();
    const card = screen
      .getByRole("region", { name: "Start something" })
      .querySelector("button") as HTMLElement;
    const line = screen.getByText("Tasks run on Office PC (connected).");
    // 4 = DOCUMENT_POSITION_FOLLOWING: the line follows the card.
    expect((card.compareDocumentPosition(line) & 4) === 4).toBe(true);
  });

  test("Given the host is offline, Then a notice says tasks cannot start until it is back", () => {
    view({ status: "offline" });
    const notice = screen.queryByRole("alert");
    expect(notice?.textContent ?? "").toContain("Office PC is not connected");
    expect(screen.queryByText("Tasks run on Office PC (not connected).")).not.toBeNull();
  });

  test("Given no folder is allowed yet, Then Home says so before a card is picked, and the link opens Settings", async () => {
    const calls = view({ folders: [] });
    expect(screen.queryByText(/No folder is set up yet/)).not.toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Settings to add a folder" }));
    });
    expect(calls).toEqual(["settings"]);
    cleanup();
    view({ folders: ["/work"] });
    expect(screen.queryByText(/No folder is set up yet/) === null).toBe(true);
  });

  test("Given the host does not accept this app or needs an update, Then the notice says that, not 'check it is on'", () => {
    view({ status: "unauthorized" });
    expect(screen.queryByRole("alert")?.textContent ?? "").toContain("did not accept this app");
    cleanup();
    view({ status: "incompatible" });
    expect(screen.queryByRole("alert")?.textContent ?? "").toContain("needs an update");
    cleanup();
    view({ status: "incompatible", lang: "pt-BR" });
    expect(screen.queryByRole("alert")?.textContent ?? "").toContain("precisa de uma atualização");
  });

  test("Given the host is not connected, When a card is opened, Then Start is held with the reason", async () => {
    view({ status: "offline" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Summarise a folder/ }));
    });
    const dialog = screen.getByRole("dialog", { name: "Summarise a folder" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Which folder?" }), {
      target: { value: "/work/Notes" },
    });
    const start = within(dialog).getByRole("button", { name: "Start this task" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).queryByText("Office PC is not connected.")).not.toBeNull();
  });

  test("Given the host's folders are not known yet, Then Home does not say none is set up", () => {
    view({ folders: null });
    expect(screen.queryByText(/No folder is set up yet/) === null).toBe(true);
  });

  test("Given a card that edits files, Then it says so without promising a question each time", () => {
    const edits: typeof BUILTIN_TEMPLATES = [
      { ...(BUILTIN_TEMPLATES[0] as (typeof BUILTIN_TEMPLATES)[number]), preset: "edit_folder" },
    ];
    view({ templates: edits });
    const card = screen.getByRole("button", { name: /Summarise a folder/ });
    expect(card.textContent).toContain("Edits files in the folder you pick.");
    expect(card.textContent).not.toContain("asking");
  });

  test("Given no ready-made tasks and no task yet, Then no steps point at cards that are not there", () => {
    view({ templates: [] });
    expect(screen.queryByRole("list", { name: "How a task goes" }) === null).toBe(true);
  });
});
