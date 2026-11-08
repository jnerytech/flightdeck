import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { TeamsPage } = await import("../src/ui/TeamsPage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const host = {
  id: "h1",
  name: "alfa",
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: { daemonVersion: "x", features: ["teams"] },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
};

const team = (id: string, name: string, state: "active" | "paused" | "closed") => ({
  id,
  name,
  projectId: "p1",
  goal: "Ship the login.",
  coordinator: "coord",
  members: [],
  checks: [],
  state,
  pausedBy: null,
  instructionsVersion: 1,
  createdAt: "2026-11-07T10:00:00Z",
});

function setup(language: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  (store as unknown as { update(p: object): void }).update({ hosts: [host] });
  store.loadProjects = (async () => {}) as never;
  const sent: Array<[string, string, unknown]> = [];
  let teams = [team("t-closed", "old-crew", "closed"), team("t-open", "live-crew", "active")];
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    sent.push([hostId, type, payload]);
    if (type === "teams.list") return { teams };
    if (type === "teams.delete") {
      const gone = teams.find((t) => t.id === (payload as { team: string }).team);
      teams = teams.filter((t) => t !== gone);
      return gone ?? null;
    }
    return null;
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <TeamsPage store={store} host="h1" go={() => {}} />
    </TContext.Provider>,
  );
  const deletes = () => sent.filter(([, type]) => type === "teams.delete");
  return { store, sent, deletes };
}

const ready = (name: string) =>
  settle(() => screen.queryByRole("listitem", { name: `Team ${name}` }) !== null);
const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });
const openMenu = async (label: string) => {
  const button = screen.queryByRole("button", { name: label });
  expect(button === null).toBe(false);
  await act(async () => {
    fireEvent.pointerDown(button as Element, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
};

// Issue #934: a closed team keeps its card forever; it can be deleted from the card's menu.
describe("times-apagar-ui: Delete team", () => {
  test("a closed team's menu offers Delete team; its confirmation names the team, what goes and what stays", async () => {
    const w = setup();
    await ready("old-crew");
    await openMenu("Actions for old-crew");
    const item = screen.queryByRole("menuitem", { name: "Delete team" });
    expect(item === null).toBe(false);
    expect(item?.getAttribute("aria-disabled")).toBeNull();
    await click(item as Element);
    const dialog = screen.queryByRole("alertdialog");
    expect(dialog === null).toBe(false);
    const text = dialog?.textContent ?? "";
    expect(text).toContain("old-crew");
    expect(text).toContain("The team record and its card on this page go");
    expect(text).toContain("transcripts and history");
    expect(text).toContain("board cards");
    expect(w.deletes()).toEqual([]);
  });

  test("Cancel deletes nothing; Delete team sends teams.delete for that team and the card goes", async () => {
    const w = setup();
    await ready("old-crew");
    await openMenu("Actions for old-crew");
    await click(screen.getByRole("menuitem", { name: "Delete team" }));
    const dialog = screen.getByRole("alertdialog");
    // Both buttons are plain buttons, in the tab order, and the focus starts inside the dialog.
    const cancel = within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    const confirm = within(dialog).getByRole("button", {
      name: "Delete team",
    }) as HTMLButtonElement;
    expect(cancel.disabled || confirm.disabled).toBe(false);
    expect(dialog.contains(document.activeElement)).toBe(true);
    await click(cancel);
    expect(w.deletes()).toEqual([]);
    expect(screen.queryByRole("alertdialog") === null).toBe(true);
    await openMenu("Actions for old-crew");
    await click(screen.getByRole("menuitem", { name: "Delete team" }));
    await click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete team" }),
    );
    await settle(() => w.deletes().length === 1);
    expect(w.deletes()).toEqual([["h1", "teams.delete", { team: "t-closed" }]]);
    await settle(() => screen.queryByRole("listitem", { name: "Team old-crew" }) === null);
    expect(screen.queryByRole("listitem", { name: "Team live-crew" }) === null).toBe(false);
  });

  test("an open team's Delete team is off, and the menu says to close it first", async () => {
    const w = setup();
    await ready("live-crew");
    await openMenu("Actions for live-crew");
    const item = screen.queryByRole("menuitem", { name: /Delete team/ });
    expect(item === null).toBe(false);
    expect(item?.getAttribute("aria-disabled")).toBe("true");
    expect(item?.textContent).toContain("Close the team first");
    await click(item as Element);
    expect(screen.queryByRole("alertdialog") === null).toBe(true);
    expect(w.deletes()).toEqual([]);
  });

  test("it reads in Portuguese too", async () => {
    const w = setup("pt-BR");
    await settle(() => screen.queryByRole("listitem", { name: "Time old-crew" }) !== null);
    await openMenu("Ações de old-crew");
    await click(screen.getByRole("menuitem", { name: "Excluir time" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("old-crew");
    expect(dialog.textContent).toContain("transcrições e o histórico");
    await click(within(dialog).getByRole("button", { name: "Excluir time" }));
    await settle(() => w.deletes().length === 1);
  });
});
