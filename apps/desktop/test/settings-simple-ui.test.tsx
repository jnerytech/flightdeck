import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SettingsView } = await import("../src/components/simple/settings-view.tsx");

afterEach(cleanup);

function view(
  over: {
    lang?: "en" | "pt-BR";
    folders?: string[];
    canSwitch?: boolean;
    canPickFolder?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const lang = over.lang ?? "en";
  render(
    <SettingsView
      t={translator(lang, "simple")}
      lang={lang}
      onLang={(l) => void calls.push(`lang:${l}`)}
      theme="system"
      onTheme={(m) => void calls.push(`theme:${m}`)}
      folders={over.folders ?? ["/home/ana/Reports"]}
      onAddFolder={async (path) => {
        calls.push(`add:${path}`);
        return true;
      }}
      canPickFolder={over.canPickFolder ?? false}
      onPickFolder={async () => "/home/ana/Notes"}
      notifications={true}
      onNotifications={(on) => void calls.push(`notify:${on}`)}
      canSwitch={over.canSwitch ?? true}
      onShowEverything={() => void calls.push("everything")}
    />,
  );
  return calls;
}

describe("settings-simple-ui: five things and nothing else", () => {
  test("Given the settings, Then they hold language, theme, folders, notifications and the switch, and no technical section", () => {
    view();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Language",
      "Theme",
      "Folders tasks may use",
      "Notifications",
      "More",
    ]);
    expect(document.body.textContent).not.toMatch(/hook|budget|vault|terminal|token|MCP|persona/i);
  });

  test("Given a language or a theme chosen, Then the app is told", async () => {
    const calls = view();
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
        target: { value: "pt-BR" },
      });
      fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), {
        target: { value: "dark" },
      });
    });
    expect(calls).toEqual(["lang:pt-BR", "theme:dark"]);
  });

  test("Given the folders, Then they read as a plain list with what they are for, and an empty list says what to do", () => {
    view({ folders: ["/home/ana/Reports", "/home/ana/Notes"] });
    expect(
      screen.getByText("Tasks can only look at and change files inside these folders."),
    ).toBeTruthy();
    const list = screen.getByRole("list", { name: "Folders tasks may use" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["/home/ana/Reports", "/home/ana/Notes"]);
    cleanup();
    view({ folders: [] });
    expect(screen.getByText(/No folder yet/)).toBeTruthy();
  });

  test("Given a folder typed, When Add folder is pressed, Then it is asked for; the button waits until something is typed", async () => {
    const calls = view();
    const add = screen.getByRole("button", { name: "Add folder" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByText("Type or choose the folder to add.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Folder to add" }), {
      target: { value: "/home/ana/Invoices" },
    });
    await act(async () => {
      fireEvent.click(add);
    });
    expect(calls).toEqual(["add:/home/ana/Invoices"]);
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Folder to add" }) as HTMLInputElement).value,
      ).toBe(""),
    );
  });

  test("Given the folder dialog, When Choose folder is pressed, Then the folder fills in", async () => {
    view({ canPickFolder: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Folder to add" }) as HTMLInputElement).value,
      ).toBe("/home/ana/Notes"),
    );
  });

  test("Given notifications, When they are switched, Then the app is told", async () => {
    const calls = view();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Tell me when a task needs my answer or is done" }),
      );
    });
    expect(calls).toEqual(["notify:false"]);
  });

  test("Given the way back to the full app, When Show everything is pressed, Then one line asks first, and only yes goes on", async () => {
    const calls = view();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show everything" }));
    });
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("This shows the technical screens.")).toBeTruthy();
    expect(calls).toEqual([]);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Show everything" }));
    });
    expect(calls).toEqual(["everything"]);
  });

  test("Given a locked host, Then there is no Show everything and no More section", () => {
    view({ canSwitch: false });
    expect(screen.queryByRole("button", { name: "Show everything" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "More" })).toBeNull();
  });

  test("Given Portuguese, Then it reads in Portuguese", () => {
    view({ lang: "pt-BR" });
    expect(screen.getByRole("heading", { name: "Pastas que as tarefas podem usar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mostrar tudo" })).toBeTruthy();
  });
});
