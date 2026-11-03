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

  test("Given no task yet, Then a first-task prompt shows, and no waiting strip", () => {
    view();
    expect(screen.getByText(/Pick one of the cards above/)).toBeTruthy();
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
});
